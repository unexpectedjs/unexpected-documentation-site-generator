# The Unexpected documentation site generator

This is a documentation site generator extracted from
[unexpected](http://unexpectedjs.github.io/). This module in only
useful for building documentation sites for unexpected plugins and
unexpected itself.

Then you add the following scripts to `package.json`:

```json
"scripts": {
  "generate-site": "generate-site",
  "deploy-site": "deploy-site"
},
```

If you need a custom setup for your pages, you can add a bootstrap file. By
convertion we call this `bootstrap-unexpected-markdown.js` which we add to
the project root containing the following code:

```js
// It is important that unexpected is global:
expect = require('unexpected').clone();
expect.use(require('my-plugin'));
```

This setup file allows defining additional globals that will be available to
the examples in your documentation files. In this example we use it to define
the version of unexpected to uswe when testing and load a plugin by default.

We know this step my be a little annoying, but we need to control which version
of unexpected is used and our experience has shown a peer dependency wont cut it.

Then you update your npm scripts to require the bootstrap file:

```json
"scripts": {
  "generate-site": "generate-site --require ./bootstrap-unexpected-markdown.js",
  "deploy-site": "deploy-site"
},
```

Now you are ready to add markdown files in a documentation directory. The
subfolders `assertions` and `api` are special. In the `assertions`
folder you add documentation for assertions grouped by type. In the
`api` folder you add documentation for api methods. See
[unexpected](https://github.com/unexpectedjs/unexpected/tree/master/documentation)
as an example on how to structure the documentation.

## generate-site options

### `--require <file>`

Specify a file to be required into the global scope.

### `--output <directory>`

Changes the default output directory from `site-build`.

### `--assertions <glob pattern>`

Changes the default pattern for finding assertion files from `assertions/*/*.md`.
