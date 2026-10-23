const { withMainActivity } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-application-back-gesture';
const START = `// @generated begin ${PLUGIN_NAME}`;
const END = `// @generated end ${PLUGIN_NAME}`;
const IMPORT = 'import chat.psstpsst.app.napplet.installApplicationBackGesture';

function applyAndroidBackGesture(contents) {
  let next = contents;
  if (!next.includes(`${IMPORT}\n`)) {
    const declaration = /^package [^\n]+\n/m;
    if (!declaration.test(next)) throw new Error(`${PLUGIN_NAME}: unable to find MainActivity package declaration`);
    next = next.replace(declaration, match => `${match}\n${IMPORT}\n`);
  }
  if (next.includes(START)) return next;
  const superCall = /^([ \t]*)super\.onCreate\((?:null|savedInstanceState)\)[ \t]*$/m;
  if (!superCall.test(next)) throw new Error(`${PLUGIN_NAME}: unable to find MainActivity.onCreate`);
  return next.replace(superCall, (match, indent) => [match, `${indent}${START}`,
    `${indent}installApplicationBackGesture(this)`, `${indent}${END}`].join('\n'));
}

function withApplicationBackGesture(config) {
  return withMainActivity(config, result => {
    if (result.modResults.language !== 'kt') throw new Error(`${PLUGIN_NAME}: only Kotlin MainActivity files are supported`);
    result.modResults.contents = applyAndroidBackGesture(result.modResults.contents);
    return result;
  });
}

module.exports = withApplicationBackGesture;
module.exports.applyAndroidBackGesture = applyAndroidBackGesture;
