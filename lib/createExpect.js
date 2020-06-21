/* global expect */
module.exports = function(options) {
  options = { ...options };
  var localExpect;
  if (options.unexpected) {
    localExpect = options.unexpected.clone();
  } else if (typeof expect === 'undefined') {
    localExpect = require('unexpected').clone();
    localExpect.output.preferredWidth = 80;
  } else {
    localExpect = expect.clone();
  }

  if (options.preferredWidth) {
    localExpect.output.preferredWidth = options.preferredWidth;
  }

  if (typeof options.indentationWidth === 'number') {
    localExpect.output.indentationWidth = options.indentationWidth;
  }

  localExpect.installPlugin(require('magicpen-prism'));

  var themePlugin =
    options.theme === 'dark'
      ? require('./magicpenDarkSyntaxTheme')
      : require('./magicpenGithubSyntaxTheme');

  return localExpect.installPlugin(themePlugin);
};
