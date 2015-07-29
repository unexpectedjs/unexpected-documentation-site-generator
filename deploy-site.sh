#!/bin/sh
if [ -n "$(git describe --always --dirty | grep -- -dirty)" ]
then
    echo "Working tree is dirty, please commit or stash your changes, then try again"
    exit 1
fi

TARGET_BRANCH=${1:-gh-pages}
CURRENT_BRANCH=`git symbolic-ref -q HEAD | sed -e 's|^refs/heads/||'`
npm run generate-site
git fetch origin $TARGET_BRANCH
if [ `git branch --list origin/$TARGET_BRANCH `]; then \
    git checkout -B $TARGET_BRANCH origin/$TARGET_BRANCH
else \
    git checkout --orphan $TARGET_BRANCH && \
    git rm -rf .
fi
rm `git ls-files | grep -v '^\.gitignore$'`
printf "node_modules\nsite-build\n" > .gitignore
cp -r site-build/* .
if [ "`git status --porcelain`" != "" ]; then \
	(git add -A . && \
	git commit -m "Updated site" && \
	git push origin +$TARGET_BRANCH:$TARGET_BRANCH)
fi
git checkout $CURRENT_BRANCH
