/*global __dirname*/
var Evaldown = require('evaldown');
var metalSmith = require('metalsmith');
var fs = require('fs').promises;
var glob = require('glob');
var os = require('os');
var path = require('path');
var rimraf = require('rimraf');
var nodeUrl = require('url');
var util = require('util');
var _ = require('lodash');

var createExpect = require('./lib/createExpect');
var globAsync = util.promisify(glob);
var rimrafAsync = util.promisify(rimraf);

async function copyDocumentationAssets(sourceDir, targetDir) {
  const assetFilePaths = await globAsync('**/!(**.md)', {
    cwd: sourceDir,
    nodir: true
  });

  for (const filePath of assetFilePaths) {
    await fs.copyFile(
      path.join(sourceDir, filePath),
      path.join(targetDir, filePath)
    );
  }
}

function idToName(id) {
  return id.replace(/-/g, ' ');
}

function getTypeHierarchy(typeIndex, typeName) {
  var tree = {};
  Object.keys(typeIndex[typeName] || {}).forEach(function(childTypeName) {
    tree[childTypeName] = getTypeHierarchy(typeIndex, childTypeName);
  });

  return tree;
}

function flattenTypeHierarchy(typeHierarchy, assertionsByType) {
  var result = [];
  Object.keys(typeHierarchy)
    .sort(function(a, b) {
      var aChildren = Object.keys(typeHierarchy[a]);
      var bChildren = Object.keys(typeHierarchy[b]);
      if (aChildren.length === 0 && bChildren.length > 0) {
        return -1;
      }
      if (aChildren.length > 0 && bChildren.length === 0) {
        return 1;
      }
      var aLength = assertionsByType[a] ? assertionsByType[a].length : 0;
      var bLength = assertionsByType[b] ? assertionsByType[b].length : 0;
      if (aLength > bLength) {
        return -1;
      }
      if (aLength < bLength) {
        return 1;
      }

      a = a.toLowerCase();
      b = b.toLowerCase();
      if (a < b) {
        return -1;
      }
      if (a > b) {
        return 1;
      }
      return 0;
    })
    .forEach(function(typeName) {
      result.push(typeName);
      Array.prototype.push.apply(
        result,
        flattenTypeHierarchy(typeHierarchy[typeName], assertionsByType)
      );
    });
  return result;
}

function addTypeToIndex(typeIndex, type) {
  if (type.baseType) {
    typeIndex[type.baseType.name] = typeIndex[type.baseType.name] || {};
    typeIndex[type.baseType.name][type.name] = type.name;
    addTypeToIndex(typeIndex, type.baseType);
  }
}

module.exports = async function generate(options) {
  var localExpect = createExpect(options);

  function sortTypesByHierarchy(assertionsByType) {
    var typeIndex = {};
    var unknownTypes = [];
    Object.keys(assertionsByType).forEach(function(typeName) {
      var type = localExpect.getType(typeName);
      if (type) {
        addTypeToIndex(typeIndex, type);
      } else {
        unknownTypes.push(typeName);
      }
    });

    var typeHierarchy = { any: getTypeHierarchy(typeIndex, 'any') };

    var result = {};

    flattenTypeHierarchy(typeHierarchy, assertionsByType)
      .concat(unknownTypes)
      .forEach(function(typeName) {
        if (assertionsByType[typeName]) {
          result[typeName] = assertionsByType[typeName];
        }
      });

    return result;
  }

  var cwd = options.cwd || process.cwd();
  var assertionsPattern = options.assertions || [
    'assertions/*/*.md',
    'assertions.md'
  ];
  var documentation = path.join(cwd, 'documentation');
  var output = !options.output
    ? path.join(cwd, 'site-build')
    : path.join(
        cwd,
        path.isAbsolute(options.output)
          ? path.relative(cwd, options.output)
          : options.output
      );

  var tmpOutput = path.join(os.tmpdir(), 'udsg', String(process.pid));

  var config;
  try {
    config = require(path.join(cwd, options.config));
  } catch (e) {
    config = null;
  }
  options = { ...config, ...options };
  options = { ...options, ...(await Evaldown.decodeOptions(cwd, options)) };

  const statsObject = await new Evaldown({
    ...options,
    commentMarker: 'unexpected-markdown',
    outputFormat: 'inlined',
    sourcePath: documentation,
    targetPath: tmpOutput,
    fileGlobals: {
      expect: options => createExpect(options.metadata)
    }
  }).processFiles();

  const stats = statsObject.toJSON();
  console.log(`evaldown completed with ${JSON.stringify(stats)}`);
  if (stats.total === 0 || stats.errored === stats.total) {
    throw new Error(
      'No documentation was successfully generated. Unable to proceed.'
    );
  }

  let baseUrl = options['base-url'] || '/';
  try {
    const { pathname } = nodeUrl.parse(baseUrl);
    if (pathname === null || !pathname.startsWith('/')) {
      throw new Error();
    }
    if (!baseUrl.endsWith('/')) baseUrl += '/';
  } catch (e) {
    throw new Error(`Invalid base url "${baseUrl}". Unable to proceed.`);
  }

  await copyDocumentationAssets(documentation, tmpOutput);

  console.log(`copied documentation assets to temporary dir: ${tmpOutput}`);

  const metalsmithPromise = new Promise((resolve, reject) => {
    metalSmith('.')
      .destination(output)
      .source(tmpOutput)
      .use(
        require('@metalsmith/collections')({
          assertions: {
            pattern: assertionsPattern
          },
          apiPages: {
            pattern: ['api/*.md', 'api.md']
          },
          pages: {
            pattern: ['*.md', '!assertions.md', '!api.md']
          }
        })
      )
      .use(
        require('./lib/include-static-assets')({
          path: path.resolve(__dirname, 'static')
        })
      )
      // Dynamicly generate metadata for assertion files
      .use(function(files, metalsmith, next) {
        Object.keys(files)
          .filter(function(file) {
            return /\.md$/.test(file);
          })
          .forEach(function(file) {
            const id = file.match(/([^/]+)\.md$/)[1];
            const name = idToName(id);

            if (!files[file].template) files[file].template = 'default.ejs';
            files[file].layout = files[file].template;

            if (files[file].collection.indexOf('apiPages') !== -1) {
              files[file].layout = 'api.ejs';

              if (file === 'api.md') {
                files[file].title = 'API';
              }
            } else if (files[file].collection.indexOf('assertions') !== -1) {
              files[file].layout = 'assertion.ejs';
              files[file].declarations = [];

              if (file === 'assertions.md') {
                files[file].title = 'Assertions';
              } else {
                const type = file.match(/^assertions\/([^/]+)/)[1];

                files[file].declarations = _.uniq(
                  (localExpect.assertions[name] || [])
                    .filter(function(assertionRule) {
                      return assertionRule.subject.type.name === type;
                    })
                    .map(function(assertionRule) {
                      return assertionRule.declaration.replace(
                        /<.*?>/,
                        '<' + assertionRule.subject.type.name + '>'
                      );
                    })
                );

                files[file].windowTitle = name + ' (' + type + ')';
                files[file].type = type;
              }
            }

            if (!files[file].title) {
              files[file].title = name;
            }

            if (!files[file].windowTitle) {
              files[file].windowTitle = files[file].title;
            }

            const pagePath = /(\/?)index.md$/.test(file)
              ? file.replace(/(\/?)index.md$/, '$1')
              : file;
            const pageName = path.basename(pagePath).replace(/\.md$/, '');
            files[file].pageName = pageName;
            files[file].path =
              pageName === '' ? '' : `${path.dirname(pagePath)}/${pageName}/`;
            files[file].url = `${baseUrl}${files[file].path}`;
          });
        next();
      })
      .use(function(files, metalsmith, next) {
        var metadata = metalsmith.metadata();

        metadata.baseUrl = baseUrl;

        metadata.collections.menuPages = metadata.collections.pages.filter(
          function(page) {
            return page.path !== '' && page.menuPage !== false;
          }
        );

        metadata.collections.menuPages.forEach(function(page) {
          page.collection.push('menuPages');
        });

        metadata.collections.apiPages.sort(function(a, b) {
          var aTitle = a.title.toLowerCase();
          var bTitle = b.title.toLowerCase();
          if (aTitle < bTitle) {
            return -1;
          }
          if (aTitle > bTitle) {
            return 1;
          }
          return 0;
        });

        // Make sure that the most important types are listed first and in this order:
        var assertionsByType = {};
        metadata.collections.assertions.forEach(function(assertion) {
          if (assertion.type) {
            assertionsByType[assertion.type] =
              assertionsByType[assertion.type] || [];
            assertionsByType[assertion.type].push(assertion);
          }
        });

        assertionsByType = sortTypesByHierarchy(assertionsByType);
        Object.keys(assertionsByType).forEach(function(type) {
          assertionsByType[type].sort(function(a, b) {
            var aName = a.title.toLowerCase();
            var bName = b.title.toLowerCase();
            if (aName < bName) {
              return -1;
            }
            if (aName > bName) {
              return 1;
            }
            return 0;
          });
        });
        metadata.assertionsByType = assertionsByType;

        metadata.assertionsUrl = null;
        if (Object.keys(assertionsByType).length > 0) {
          metadata.assertionsUrl = metadata.collections.assertions.some(
            page => page.path === 'assertions/'
          )
            ? `${baseUrl}assertions/`
            : assertionsByType[Object.keys(assertionsByType)[0]][0].url;
        }

        metadata.apiPagesUrl = null;
        if (metadata.collections.apiPages.length > 0) {
          metadata.apiPagesUrl = metadata.collections.apiPages.some(
            page => page.path === 'api/'
          )
            ? `${baseUrl}api/`
            : metadata.collections.apiPages[0].url;
        }

        next();
      })
      .use(function(files, metalsmith, next) {
        var metadata = metalsmith.metadata();
        Object.keys(metadata.assertionsByType).forEach(function(type) {
          var declarations = [];
          metadata.assertionsByType[type].forEach(function(assertion) {
            Array.prototype.push.apply(declarations, assertion.declarations);
          });

          var path = 'assertions/' + type + '/';
          var file = 'assertions/' + type + '.html';
          files[file] = {
            windowTitle: type,
            title: type,
            declarations: _.uniq(declarations),
            layout: 'type.ejs',
            template: 'type.ejs',
            path,
            url: `${baseUrl}${path}`,
            contents: ''
          };
        });
        next();
      })
      .use(function(files, metalsmith, next) {
        var metadata = metalsmith.metadata();
        var indexData = [];

        metadata.collections.apiPages.forEach(function(assertion) {
          indexData.push({
            label: assertion.title + ' (api)',
            url: assertion.url
          });
        });

        metadata.collections.assertions.forEach(function(assertion) {
          indexData.push({
            label: assertion.windowTitle,
            url: assertion.url
          });
        });
        files['searchIndex.json'] = {
          contents: JSON.stringify(indexData, null, 2)
        };
        next();
      })
      .use(require('@metalsmith/markdown')())
      // permalinks with no options will just make pretty urls...
      .use(require('@metalsmith/permalinks')({ relative: false }))
      .use(function(files, metalsmith, next) {
        // Useful for debugging ;-)
        // require('uninspected').log(files);
        next();
      })
      .use(
        require('@fidian/metalsmith-less')({
          removeSource: true
        })
      )
      .use(require('metalsmith-html-relative')())
      .use(
        require('@metalsmith/layouts')({
          directory: path.join(__dirname, 'templates'),
          pattern: '**/*.html'
        })
      )
      .build(function(err) {
        if (err) {
          reject(err);
        } else {
          console.log('wrote site to ' + output);
          resolve();
        }
      });
  });

  try {
    await metalsmithPromise;
  } finally {
    await rimrafAsync(tmpOutput, { glob: false });
  }
};
