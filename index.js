/*global __dirname, unexpected*/
var metalSmith = require('metalsmith');
var path = require('path');
var _ = require('lodash');

function idToName(id) {
    return id.replace(/-/g, ' ');
}

function getTypeHierarchy(typeIndex, typeName) {
    var tree = {};
    Object.keys(typeIndex[typeName] || {}).forEach(function (childTypeName) {
        tree[childTypeName] = getTypeHierarchy(typeIndex, childTypeName);
    });

    return tree;
}

function flattenTypeHierarchy(typeHierarchy, assertionsByType) {
    var result = [];
    Object.keys(typeHierarchy).sort(function (a, b) {
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
        if (a < b) { return -1; }
        if (a > b) { return 1; }
        return 0;
    }).forEach(function (typeName) {
        result.push(typeName);
        Array.prototype.push.apply(result, flattenTypeHierarchy(typeHierarchy[typeName], assertionsByType));
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

function createExpect(options) {
    if (options.unexpected) {
        return options.unexpected.clone();
    }

    if (typeof unexpected !== 'undefined') {
        return unexpected.clone();
    }

    return require('unexpected').clone();
}


module.exports = function generate(options) {
    if (options.require) {
        var moduleNames = options.require;
        if (!Array.isArray(moduleNames)) {
            moduleNames = [ moduleNames ];
        }
        moduleNames.forEach(function (moduleName) {
            if (/^[\.\/]/.test(moduleName)) {
                moduleName = path.resolve(process.cwd(), moduleName);
            }
            require(moduleName);
        });
    }

    var expect = createExpect(options);

    function sortTypesByHierarchy(assertionsByType) {
        var typeIndex = {};
        var unknownTypes = [];
        Object.keys(assertionsByType).forEach(function (typeName) {
            var type = expect.getType(typeName);
            if (type) {
                addTypeToIndex(typeIndex, type);
            } else {
                unknownTypes.push(typeName);
            }
        });

        var typeHierarchy = { 'any': getTypeHierarchy(typeIndex, 'any') };

        var result = {};

        flattenTypeHierarchy(typeHierarchy, assertionsByType).concat(unknownTypes).forEach(function (typeName) {
            if (assertionsByType[typeName]) {
                result[typeName] = assertionsByType[typeName];
            }
        });

        return result;
    }

    var assertionsPattern = options.assertions || 'assertions/*/*.md';
    var output = options.output || 'site-build';

    metalSmith('.')
        .destination(output)
        .source('documentation')
        .use(require('metalsmith-collections')({
            assertions: {
                pattern: assertionsPattern
            },
            apiPages: {
                pattern: 'api/*.md'
            },
            pages: {
                pattern: '*.md'
            }
        }))
        .use(require('./lib/include-static-assets')({ path: path.resolve(__dirname, 'static') }))
    // Dynamicly generate metadata for assertion files
        .use(function (files, metalsmith, next) {
            Object.keys(files).filter(function (file) {
                return /\.md$/.test(file);
            }).forEach(function (file) {
                var id = file.match(/([^\/]+)\.md$/)[1];
                var name = idToName(id);

                if (!files[file].title) {
                    files[file].title = name;
                }

                if (files[file].collection.indexOf('apiPages') !== -1) {
                    files[file].template = 'api.ejs';
                } else if (files[file].collection.indexOf('assertions') !== -1) {
                    var type = file.match(/^assertions\/([^\/]+)/)[1];

                    files[file].declarations = _.uniq((expect.assertions[name] || []).filter(function (assertionRule) {
                        return assertionRule.subject.type.name === type;
                    }).map(function (assertionRule) {
                        return assertionRule.declaration.replace(/<.*?>/, '<' + assertionRule.subject.type.name + '>');
                    }));

                    files[file].template = 'assertion.ejs';
                    files[file].windowTitle = type + ' - ' + name;
                    files[file].type = type;
                }

                if (!files[file].windowTitle) {
                    files[file].windowTitle = files[file].title;
                }

                files[file].url = '/' + file.replace(/(\/?)index.md$/, '$1').replace(/\.md$/, '/');
            });
            next();
        })
        .use(function (files, metalsmith, next) {
            var metadata = metalsmith.metadata();

            metadata.collections.apiPages.sort(function (a, b) {
                var aTitle = a.title.toLowerCase();
                var bTitle = b.title.toLowerCase();
                if (aTitle < bTitle) { return -1; }
                if (aTitle > bTitle) { return 1; }
                return 0;
            });

            // Make sure that the most important types are listed first and in this order:
            var assertionsByType = {};
            metadata.collections.assertions.forEach(function (assertion) {
                assertionsByType[assertion.type] = assertionsByType[assertion.type] || [];
                assertionsByType[assertion.type].push(assertion);
            });

            assertionsByType = sortTypesByHierarchy(assertionsByType);
            Object.keys(assertionsByType).forEach(function (type) {
                assertionsByType[type].sort(function (a, b) {
                    var aName = a.title.toLowerCase();
                    var bName = b.title.toLowerCase();
                    if (aName < bName) { return -1; }
                    if (aName > bName) { return 1; }
                    return 0;
                });
            });
            metadata.assertionsByType = assertionsByType;
            next();
        })
        .use(function (files, metalsmith, next) {
            var metadata = metalsmith.metadata();
            Object.keys(metadata.assertionsByType).forEach(function (type) {
                var declarations = [];
                metadata.assertionsByType[type].forEach(function (assertion) {
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
        .use(function (files, metalsmith, next) {
            var metadata = metalsmith.metadata();
            var indexData = [];

            metadata.collections.apiPages.forEach(function (assertion) {
                indexData.push({
                    label: assertion.title + ' (api)',
                    url: assertion.url
                });
            });

            metadata.collections.assertions.forEach(function (assertion) {
                indexData.push({
                    label: assertion.title + ' (' + assertion.type + ')',
                    url: assertion.url
                });
            });
            files['searchIndex.json'] = { contents: JSON.stringify(indexData, null, 2) };
            next();
        })
        .use(require('metalsmith-unexpected-markdown')({
            unexpected: expect,
            updateExamples: !!options['update-examples']
        }))
    // permalinks with no options will just make pretty urls...
        .use(require('metalsmith-permalinks')({ relative: false }))
        .use(function (files, metalsmith, next) {
            // Useful for debugging ;-)
            // require('uninspected').log(files);
            next();
        })
        .use(require('metalsmith-less')())
        .use(require('metalsmith-relative')())
        .use(require('metalsmith-templates')({
            engine: 'ejs',
            directory: path.resolve(__dirname, 'templates')
        }))
        .use(require('metalsmith-autoprefixer')({ browsers: 'last 2 versions', cascade: false }))
        .use(require('./lib/delete-less-files')())
        .build(function (err) {
            if (err) { throw err; }
            console.log('wrote site to ' + output);
        });
};
