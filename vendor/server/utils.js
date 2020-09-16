"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCompilerLogOutput = exports.parseDiagnosticLocation = exports.formatUsingValidBscPath = exports.compilerLogPresentAndNotEmpty = exports.findDirOfFileNearFile = void 0;
const c = __importStar(require("./constants"));
const childProcess = __importStar(require("child_process"));
const path = __importStar(require("path"));
const t = __importStar(require("vscode-languageserver-types"));
const tmp = __importStar(require("tmp"));
const fs_1 = __importDefault(require("fs"));
// TODO: races here
// TODO: this doesn't handle file:/// scheme
exports.findDirOfFileNearFile = (fileToFind, source) => {
    let dir = path.dirname(source);
    if (fs_1.default.existsSync(path.join(dir, fileToFind))) {
        return dir;
    }
    else {
        if (dir === source) {
            // reached top
            return null;
        }
        else {
            return exports.findDirOfFileNearFile(fileToFind, dir);
        }
    }
};
exports.compilerLogPresentAndNotEmpty = (filePath) => {
    let compilerLogDir = exports.findDirOfFileNearFile(c.compilerLogPartialPath, filePath);
    if (compilerLogDir == null) {
        return false;
    }
    else {
        let compilerLogPath = path.join(compilerLogDir, c.compilerLogPartialPath);
        return fs_1.default.statSync(compilerLogPath).size > 0;
    }
};
exports.formatUsingValidBscPath = (code, bscPath, isInterface) => {
    // library cleans up after itself. No need to manually remove temp file
    let tmpobj = tmp.fileSync();
    let extension = isInterface ? c.resiExt : c.resExt;
    let fileToFormat = tmpobj.name + extension;
    fs_1.default.writeFileSync(fileToFormat, code, { encoding: 'utf-8' });
    try {
        let result = childProcess.execFileSync(bscPath, ['-color', 'never', '-format', fileToFormat], { stdio: 'pipe' });
        return {
            kind: 'success',
            result: result.toString(),
        };
    }
    catch (e) {
        return {
            kind: 'error',
            error: e.message,
        };
    }
};
exports.parseDiagnosticLocation = (location) => {
    // example output location:
    // 3:9
    // 3:5-8
    // 3:9-6:1
    // language-server position is 0-based. Ours is 1-based. Don't forget to convert
    // also, our end character is inclusive. Language-server's is exclusive
    let isRange = location.indexOf('-') >= 0;
    if (isRange) {
        let [from, to] = location.split('-');
        let [fromLine, fromChar] = from.split(':');
        let isSingleLine = to.indexOf(':') >= 0;
        let [toLine, toChar] = isSingleLine ? to.split(':') : [fromLine, to];
        return {
            start: { line: parseInt(fromLine) - 1, character: parseInt(fromChar) - 1 },
            end: { line: parseInt(toLine) - 1, character: parseInt(toChar) },
        };
    }
    else {
        let [line, char] = location.split(':');
        let start = { line: parseInt(line) - 1, character: parseInt(char) };
        return {
            start: start,
            end: start,
        };
    }
};
exports.parseCompilerLogOutput = (content, separator) => {
    /* example .compiler.log file content that we're gonna parse:

    Syntax error!
    /Users/chenglou/github/reason-react/src/test.res:1:8-2:3

    1 │ let a =
    2 │ let b =
    3 │

    This let-binding misses an expression


    Warning number 8
    /Users/chenglou/github/reason-react/src/test.res:3:5-8

    1 │ let a = j`😀`
    2 │ let b = `😀`
    3 │ let None = None
    4 │ let bla: int = "
    5 │   hi

    You forgot to handle a possible case here, for example:
    Some _


    We've found a bug for you!
    /Users/chenglou/github/reason-react/src/test.res:3:9

    1 │ let a = 1
    2 │ let b = "hi"
    3 │ let a = b + 1

    This has type:
        string

    But somewhere wanted:
        int
    */
    let parsedDiagnostics = [];
    let lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.startsWith('  We\'ve found a bug for you!')) {
            parsedDiagnostics.push({
                code: undefined,
                severity: t.DiagnosticSeverity.Error,
                tag: undefined,
                content: []
            });
        }
        else if (line.startsWith('  Warning number ')) {
            let warningNumber = parseInt(line.slice('  Warning number '.length));
            let tag = undefined;
            switch (warningNumber) {
                case 11:
                case 20:
                case 26:
                case 27:
                case 32:
                case 33:
                case 34:
                case 35:
                case 36:
                case 37:
                case 38:
                case 39:
                case 60:
                case 66:
                case 67:
                case 101:
                    tag = t.DiagnosticTag.Unnecessary;
                    break;
                case 3:
                    tag = t.DiagnosticTag.Deprecated;
                    break;
            }
            parsedDiagnostics.push({
                code: Number.isNaN(warningNumber) ? undefined : warningNumber,
                severity: t.DiagnosticSeverity.Warning,
                tag: tag,
                content: []
            });
        }
        else if (line.startsWith('  Syntax error!')) {
            parsedDiagnostics.push({
                code: undefined,
                severity: t.DiagnosticSeverity.Error,
                tag: undefined,
                content: []
            });
        }
        else if (/^  +[0-9]+ /.test(line)) {
            // code display. Swallow
        }
        else if (line.startsWith('  ')) {
            parsedDiagnostics[parsedDiagnostics.length - 1].content.push(line);
        }
    }
    // map of file path to list of diagnostic
    let ret = {};
    parsedDiagnostics.forEach(parsedDiagnostic => {
        let [fileAndLocation, ...diagnosticMessage] = parsedDiagnostic.content;
        let locationSeparator = fileAndLocation.indexOf(separator);
        let file = fileAndLocation.substring(2, locationSeparator);
        let location = fileAndLocation.substring(locationSeparator + 1);
        if (ret[file] == null) {
            ret[file] = [];
        }
        let cleanedUpDiagnostic = diagnosticMessage
            .map(line => {
            // remove the spaces in front
            return line.slice(2);
        })
            .join('\n')
            // remove start and end whitespaces/newlines
            .trim() + '\n';
        ret[file].push({
            severity: parsedDiagnostic.severity,
            tags: parsedDiagnostic.tag === undefined ? [] : [parsedDiagnostic.tag],
            code: parsedDiagnostic.code,
            range: exports.parseDiagnosticLocation(location),
            source: "ReScript",
            message: cleanedUpDiagnostic,
        });
    });
    console.log(ret, '=========');
    return ret;
};
//# sourceMappingURL=utils.js.map