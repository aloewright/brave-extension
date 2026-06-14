# NodeWarden upstream tracking

This app is vendored from:

- Repository: `https://github.com/shuaiplus/nodewarden`
- Commit: `e9aef72df7929066e06a7b4ca0cda2012bb937ac`
- Version: `1.6.0`
- License: LGPL-3.0

The upstream source is copied into this directory rather than mixed into the extension runtime. Keep local changes small and documented so upstream security fixes can be merged forward.

To refresh the vendored copy, run:

```bash
npm run upstream:sync
```

Then review local diffs before rebuilding or deploying.
