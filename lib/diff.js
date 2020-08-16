const { Point, Range } = require("atom");
const { diffLines } = require("diff");

module.exports = function diff(original, text) {
  let edits = [];
  let pos = new Point(0, 0);

  let lineDiffs = diffLines(original, text, {
    ignoreCase: false,
    newlineIsToken: true,
    ignoreWhitespace: false,
  });

  for (let { value, added, removed } of lineDiffs) {
    const m = value.match(/\r\n|\n|\r/g);
    const row = m ? m.length : 0;
    const newlineIndex = Math.max(
      value.lastIndexOf("\n"),
      value.lastIndexOf("\r")
    );
    const col = value.length - (newlineIndex + 1);
    const endPos = pos.traverse([row, col]);

    if (added) {
      edits.push({ oldRange: new Range(pos, pos), newText: value });
    } else if (removed) {
      edits.push({ oldRange: new Range(pos, endPos), newText: "" });
      pos = endPos;
    } else {
      pos = endPos;
    }
  }

  return edits;
};
