/*global __dirname*/
var fsExtra = require('fs-extra');
var Evaldown = require('evaldown');
var metalSmith = require('metalsmith');
var path = require('path');
var _ = require('lodash');

var createExpect = require('./lib/createExpect');

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
  if (options.require) {
    var moduleNames = options.require;
    if (!Array.isArray(moduleNames)) {
      moduleNames = [moduleNames];
    }
    moduleNames.forEach(function(moduleName) {
      if (/^[./]/.test(moduleName)) {
        moduleName = path.resolve(process.cwd(), moduleName);
      }
      require(moduleName);
    });
  }

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

  var cwd = process.cwd();
  var assertionsPattern = options.assertions || [
    'assertions/*/*.md',
    'assertions.md'
  ];
  var output = options.output || 'site-build';
  var tmpOutput = `${output}-tmp`;

  const stats = await new Evaldown({
    commentMarker: 'unexpected-markdown',
    outputFormat: 'inlined',
    sourcePath: path.join(cwd, 'documentation'),
    targetPath: path.join(cwd, tmpOutput),
    fileGlobals: {
      expect: options => createExpect(options.metadata)
    },
    update: !!options['update-examples']
  }).processFiles();

  console.log(`evaldown completed with ${JSON.stringify(stats)}`);

  await new Promise((resolve, reject) => {
    metalSmith('.')
      .destination(output)
      .source(tmpOutput)
      .use(
        require('metalsmith-collections')({
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

            if (files[file].collection.indexOf('apiPages') !== -1) {
              files[file].template = 'api.ejs';

              if (file === 'api.md') {
                files[file].title = 'API';
              }
            } else if (files[file].collection.indexOf('assertions') !== -1) {
              files[file].template = 'assertion.ejs';
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

            files[file].url =
              '/' + file.replace(/(\/?)index.md$/, '$1').replace(/\.md$/, '/');
          });
        next();
      })
      .use(function(files, metalsmith, next) {
        var metadata = metalsmith.metadata();

        metadata.collections.menuPages = metadata.collections.pages.filter(
          function(page) {
            return page.url !== '/' && page.menuPage !== false;
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
            page => page.url === '/assertions/'
          )
            ? '/assertions/'
            : assertionsByType[Object.keys(assertionsByType)[0]][0].url;
        }

        metadata.apiPagesUrl = null;
        if (metadata.collections.apiPages.length > 0) {
          metadata.apiPagesUrl = metadata.collections.apiPages.some(
            page => page.url === '/api/'
          )
            ? '/api/'
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
            template: 'type.ejs',
            url: path,
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
      .use(require('metalsmith-markdown')())
      // permalinks with no options will just make pretty urls...
      .use(require('metalsmith-permalinks')({ relative: false }))
      .use(function(files, metalsmith, next) {
        // Useful for debugging ;-)
        // require('uninspected').log(files);
        next();
      })
      .use(require('metalsmith-less')())
      .use(require('metalsmith-relative')())
      .use(
        require('metalsmith-templates')({
          engine: 'ejs',
          directory: path.resolve(__dirname, 'templates')
        })
      )
      .use(
        require('metalsmith-autoprefixer')({
          browsers: 'last 2 versions',
          cascade: false
        })
      )
      .use(require('./lib/delete-less-files')())
      .build(function(err) {
        if (err) {
          reject(err);
        } else {
          console.log('wrote site to ' + output);
          resolve();
        }
      });
  });

  await fsExtra.remove(tmpOutput);
};
