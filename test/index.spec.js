const assert = require('assert');
const cheerio = require('cheerio');
const fsAsync = require('fs').promises;
const path = require('path');

const generator = require('../index');

const ROOT_DIR = path.join(__dirname, '..');
const TESTDATA_DIR = path.join(ROOT_DIR, 'testdata');
const TESTDATA_OUTPUT_DIR = path.join(TESTDATA_DIR, 'output');

async function assertFileExists(fileName) {
  try {
    const stat = await fsAsync.stat(path.join(TESTDATA_OUTPUT_DIR, fileName));
    if (!stat.isFile()) throw new Error('not a file');
  } catch (e) {
    throw new Error(`assertFileExists: ${fileName} ${e.message}`);
  }
}

async function openAndParseOutput(fileName) {
  await assertFileExists(fileName);
  const content = await fsAsync.readFile(
    path.join(TESTDATA_OUTPUT_DIR, fileName),
    'utf8'
  );
  return cheerio.load(content);
}

describe('index', () => {
  beforeEach(async () => {
    await fsAsync.rmdir(TESTDATA_OUTPUT_DIR, { recursive: true });
    await fsAsync.mkdir(TESTDATA_OUTPUT_DIR, { recursive: true });
  });

  it('should generate documentation to a default path', async () => {
    await fsAsync.mkdir(path.join(TESTDATA_OUTPUT_DIR, 'documentation'));
    await fsAsync.copyFile(
      path.join(TESTDATA_DIR, 'basic/documentation/index.md'),
      path.join(TESTDATA_OUTPUT_DIR, 'documentation/index.md')
    );

    await generator({
      cwd: TESTDATA_OUTPUT_DIR
    });

    await assertFileExists('site-build/index.html');
  });

  it('should generate documentation to an absolute path', async () => {
    const inputDir = path.join(TESTDATA_DIR, 'basic');

    await generator({
      cwd: inputDir,
      output: TESTDATA_OUTPUT_DIR
    });

    await assertFileExists('index.html');
  });

  it('should generate documentation to a cwd relative path', async () => {
    const inputDir = path.join(TESTDATA_DIR, 'basic');

    await generator({
      cwd: inputDir,
      output: '../output' // relative
    });

    await assertFileExists('index.html');
  });

  it('should include the title as specified in the metadata', async () => {
    const inputDir = path.join(TESTDATA_DIR, 'basic');

    await generator({
      cwd: inputDir,
      output: TESTDATA_OUTPUT_DIR
    });

    const $ = await openAndParseOutput('index.html');
    assert.strictEqual($('title').text(), 'BasicTestdata');
  });

  it('should include the repository as specified in the metadata', async () => {
    const inputDir = path.join(TESTDATA_DIR, 'basic');

    await generator({
      cwd: inputDir,
      output: TESTDATA_OUTPUT_DIR
    });

    const $ = await openAndParseOutput('index.html');
    assert.strictEqual(
      $('.github-ribbon').attr('href'),
      'https://github.com/someorg/somerepo'
    );
  });
});
