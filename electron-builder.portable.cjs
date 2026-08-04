const packageJson = require('./package.json');

module.exports = {
  ...packageJson.build,
  directories: {
    ...packageJson.build.directories,
    output: 'release-portable',
  },
  win: {
    ...packageJson.build.win,
    target: [
      {
        target: 'portable',
        arch: ['x64'],
      },
    ],
    artifactName: 'Visual-Vault-Portable-${version}.${ext}',
  },
};
