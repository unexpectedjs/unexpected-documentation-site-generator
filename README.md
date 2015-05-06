# The Unexpected documentation site generator

This is a documentation site generator extracted from
[unexpected](http://unexpectedjs.github.io/). This module in only
useful for building documentation sites for unexpected plugins and
unexpected itself.

You add a `generate-site.js` file to your project containing the
following code:

```js
var argv = require('minimist')(process.argv.slice(2));

var unexpected = require('unexpected');
var generator = require('unexpected-documentation-site-generator');
argv.unexpected = unexpected;
generator(argv);
```

Then you add the following scripts to `package.json`:

```json
"scripts": {
  "generate-site": "node generate-site.js",
  "update-examples": "node generate-site.js --update-examples"
},
```

I know this is anoying but we need to control which version of
unexpected is used, and a peer dependency wont cut it.

Then you add markdown files in a documentation directory. The
subfolders `assertions` and `api` are special. In the `assertions`
folder you add documentation for assertions grouped by type. In the
`api` folder you add documentation for api methods. See
[unexpected](https://github.com/unexpectedjs/unexpected/tree/master/documentation)
as an example on how to structure the documentation.
