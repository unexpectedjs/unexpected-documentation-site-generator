#!/bin/sh
if [ -n "$(git describe --always --dirty | grep -- -dirty)" ]
then
    echo "Working tree is dirty, please commit or stash your changes, then try again"
    exit 1
fi
CURRENT_BRANCH=`git symbolic-ref -q HEAD | sed -e 's|^refs/heads/||'`
npm run generate-site
git fetch origin gh-pages
git checkout -B gh-pages origin/gh-pages
rm `git ls-files | grep -v '^\.gitignore$'`
if [ ! -f ".gitignore" ]; then
    echo "node_modules" > .gitignore
fi
cp -r site-build/* .
if [ "`git status --porcelain`" != "" ]; then \
	(git add -A . && \
	git commit -m "Updated site" && \
	git push origin +gh-pages:gh-pages)
fi
git checkout $CURRENT_BRANCH
