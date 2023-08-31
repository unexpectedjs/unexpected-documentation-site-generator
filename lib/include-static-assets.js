var async = require('async');
var mode = require('stat-mode');
var glob = require('glob');
var fs = require('fs');
var passError = require('passerror');
var path = require('path');
var util = require('util');

var globAsync = util.promisify(glob);

module.exports = function includeStaticAssets(options) {
  options = options || {};
  options.path = options.path || 'static';
  options.destination = options.destination || 'static';

  return function(files, metalsmith, done) {
    async function processStaticFiles(staticFiles) {
      return await new Promise((resolve, reject) => {
        staticFiles = staticFiles.map(function(file) {
          return path.resolve(options.path, file);
        });

        async.map(
          staticFiles,
          function(file, cb) {
            async.waterfall(
              [
                function(cb) {
                  fs.stat(
                    file,
                    passError(cb, function(data) {
                      var fileObj = {};
                      fileObj.contents = null;
                      fileObj.path = path.relative(options.path, file);
                      fileObj.stats = data;
                      fileObj.mode = mode(data).toOctal();
                      return cb(null, fileObj);
                    })
                  );
                },
                function(fileObj, cb) {
                  fs.readFile(
                    file,
                    passError(cb, function(data) {
                      fileObj.contents = data;
                      return cb(null, fileObj);
                    })
                  );
                }
              ],
              cb
            );
          },
          passError(reject, resolve)
        );
      });
    }

    (async () => {
      const globbedStaticFiles = await globAsync('**/*', { cwd: options.path });

      const fileObjs = await processStaticFiles(globbedStaticFiles);

      for (const fileObj of fileObjs) {
        const destRelative = path.join(options.destination, fileObj.path);
        files[destRelative] = fileObj;
      }
    })()
      .then(() => done())
      .catch(done);
  };
};
