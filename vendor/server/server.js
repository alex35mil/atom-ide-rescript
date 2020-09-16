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
const process_1 = __importDefault(require("process"));
const p = __importStar(require("vscode-languageserver-protocol"));
const m = __importStar(require("vscode-jsonrpc/lib/messages"));
const v = __importStar(require("vscode-languageserver"));
const path = __importStar(require("path"));
const fs_1 = __importDefault(require("fs"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const utils = __importStar(require("./utils"));
const c = __importStar(require("./constants"));
const chokidar = __importStar(require("chokidar"));
// https://microsoft.github.io/language-server-protocol/specification#initialize
// According to the spec, there could be requests before the 'initialize' request. Link in comment tells how to handle them.
let initialized = false;
// https://microsoft.github.io/language-server-protocol/specification#exit
let shutdownRequestAlreadyReceived = false;
// congrats. A simple UI problem is now a distributed system problem
let stupidFileContentCache = {};
let previouslyDiagnosedFiles = new Set();
let compilerLogPaths = new Set();
let sendUpdatedDiagnostics = () => {
    let diagnosedFiles = {};
    compilerLogPaths.forEach(compilerLogPath => {
        let content = fs_1.default.readFileSync(compilerLogPath, { encoding: 'utf-8' });
        let filesAndErrors = utils.parseCompilerLogOutput(content, ":");
        Object.keys(filesAndErrors).forEach(file => {
            // assumption: there's no existing files[file] entry
            // this is true; see the lines above. A file can only belong to one .compiler.log root
            diagnosedFiles[file] = filesAndErrors[file];
        });
    });
    // Send new diagnostic, wipe old ones
    let diagnosedFilePaths = Object.keys(diagnosedFiles);
    diagnosedFilePaths.forEach(file => {
        let params = {
            uri: file,
            // there's a new optional version param from https://github.com/microsoft/language-server-protocol/issues/201
            // not using it for now, sigh
            diagnostics: diagnosedFiles[file],
        };
        let notification = {
            jsonrpc: c.jsonrpcVersion,
            method: 'textDocument/publishDiagnostics',
            params: params,
        };
        process_1.default.send(notification);
        // this file's taken care of already now. Remove from old diagnostic files
        previouslyDiagnosedFiles.delete(file);
    });
    // wipe the errors from the files that are no longer erroring
    previouslyDiagnosedFiles.forEach(remainingPreviousFile => {
        let params = {
            uri: remainingPreviousFile,
            diagnostics: [],
        };
        let notification = {
            jsonrpc: c.jsonrpcVersion,
            method: 'textDocument/publishDiagnostics',
            params: params,
        };
        process_1.default.send(notification);
    });
    previouslyDiagnosedFiles = new Set(diagnosedFilePaths);
};
let compilerLogsWatcher = chokidar.watch([])
    .on('all', (_e, changedPath) => {
    console.log('new log change', changedPath, Math.random());
    sendUpdatedDiagnostics();
});
let addCompilerLogToWatch = (fileUri) => {
    let filePath = vscode_uri_1.uriToFsPath(vscode_uri_1.URI.parse(fileUri), true);
    let compilerLogDir = utils.findDirOfFileNearFile(c.compilerLogPartialPath, filePath);
    if (compilerLogDir != null) {
        let compilerLogPath = path.join(compilerLogDir, c.compilerLogPartialPath);
        if (!compilerLogPaths.has(compilerLogPath)) {
            console.log("added new ", compilerLogPath, "from file: ", compilerLogDir);
            compilerLogPaths.add(compilerLogPath);
            compilerLogsWatcher.add(compilerLogPath);
            // no need to call sendUpdatedDiagnostics() here; the watcher add will
            // call the listener which calls it
        }
    }
};
let removeCompilerLogToWatch = (fileUri) => {
    let filePath = vscode_uri_1.uriToFsPath(vscode_uri_1.URI.parse(fileUri), true);
    let compilerLogDir = utils.findDirOfFileNearFile(c.compilerLogPartialPath, filePath);
    if (compilerLogDir != null) {
        let compilerLogPath = path.join(compilerLogDir, c.compilerLogPartialPath);
        if (compilerLogPaths.has(compilerLogPath)) {
            console.log("remove log path ", compilerLogPath);
            compilerLogPaths.delete(compilerLogPath);
            compilerLogsWatcher.unwatch(compilerLogPath);
            sendUpdatedDiagnostics();
        }
    }
};
let stopWatchingCompilerLog = () => {
    compilerLogsWatcher.close();
};
process_1.default.on('message', (a) => {
    if (a.id == null) {
        // this is a notification message, aka client sent and forgot
        let aa = a;
        if (!initialized && aa.method !== 'exit') {
            // From spec: "Notifications should be dropped, except for the exit notification. This will allow the exit of a server without an initialize request"
            // For us: do nothing. We don't have anything we need to clean up right now
            // TODO: think of fs watcher
        }
        else if (aa.method === 'exit') {
            // The server should exit with success code 0 if the shutdown request has been received before; otherwise with error code 1
            if (shutdownRequestAlreadyReceived) {
                process_1.default.exit(0);
            }
            else {
                process_1.default.exit(1);
            }
        }
        else if (aa.method === vscode_languageserver_protocol_1.DidOpenTextDocumentNotification.method) {
            let params = aa.params;
            let extName = path.extname(params.textDocument.uri);
            if (extName === c.resExt || extName === c.resiExt) {
                console.log("new file coming", params.textDocument.uri);
                stupidFileContentCache[params.textDocument.uri] = params.textDocument.text;
                addCompilerLogToWatch(params.textDocument.uri);
            }
        }
        else if (aa.method === vscode_languageserver_protocol_1.DidChangeTextDocumentNotification.method) {
            let params = aa.params;
            let extName = path.extname(params.textDocument.uri);
            if (extName === c.resExt || extName === c.resiExt) {
                let changes = params.contentChanges;
                if (changes.length === 0) {
                    // no change?
                }
                else {
                    // we currently only support full changes
                    stupidFileContentCache[params.textDocument.uri] = changes[changes.length - 1].text;
                }
            }
        }
        else if (aa.method === vscode_languageserver_protocol_1.DidCloseTextDocumentNotification.method) {
            let params = aa.params;
            delete stupidFileContentCache[params.textDocument.uri];
            removeCompilerLogToWatch(params.textDocument.uri);
        }
    }
    else {
        // this is a request message, aka client sent request, waits for our reply
        let aa = a;
        if (!initialized && aa.method !== 'initialize') {
            let response = {
                jsonrpc: c.jsonrpcVersion,
                id: aa.id,
                error: {
                    code: m.ErrorCodes.ServerNotInitialized,
                    message: "Server not initialized."
                }
            };
            process_1.default.send(response);
        }
        else if (aa.method === 'initialize') {
            // startWatchingCompilerLog(process)
            // send the list of things we support
            let result = {
                capabilities: {
                    // TODO: incremental sync?
                    textDocumentSync: v.TextDocumentSyncKind.Full,
                    documentFormattingProvider: true,
                }
            };
            let response = {
                jsonrpc: c.jsonrpcVersion,
                id: aa.id,
                result: result,
            };
            initialized = true;
            process_1.default.send(response);
        }
        else if (aa.method === 'initialized') {
            // sent from client after initialize. Nothing to do for now
            let response = {
                jsonrpc: c.jsonrpcVersion,
                id: aa.id,
                result: null,
            };
            process_1.default.send(response);
        }
        else if (aa.method === 'shutdown') {
            // https://microsoft.github.io/language-server-protocol/specification#shutdown
            if (shutdownRequestAlreadyReceived) {
                let response = {
                    jsonrpc: c.jsonrpcVersion,
                    id: aa.id,
                    error: {
                        code: m.ErrorCodes.InvalidRequest,
                        message: `Language server already received the shutdown request`
                    }
                };
                process_1.default.send(response);
            }
            else {
                shutdownRequestAlreadyReceived = true;
                // TODO: recheck logic around init/shutdown...
                stopWatchingCompilerLog();
                let response = {
                    jsonrpc: c.jsonrpcVersion,
                    id: aa.id,
                    result: null,
                };
                process_1.default.send(response);
            }
        }
        else if (aa.method === p.DocumentFormattingRequest.method) {
            let params = aa.params;
            let filePath = vscode_uri_1.uriToFsPath(vscode_uri_1.URI.parse(params.textDocument.uri), true);
            let extension = path.extname(params.textDocument.uri);
            if (extension !== c.resExt && extension !== c.resiExt) {
                let response = {
                    jsonrpc: c.jsonrpcVersion,
                    id: aa.id,
                    error: {
                        code: m.ErrorCodes.InvalidRequest,
                        message: `Not a ${c.resExt} or ${c.resiExt} file.`
                    }
                };
                process_1.default.send(response);
            }
            else {
                let nodeModulesParentPath = utils.findDirOfFileNearFile(c.bscPartialPath, filePath);
                if (nodeModulesParentPath == null) {
                    let response = {
                        jsonrpc: c.jsonrpcVersion,
                        id: aa.id,
                        error: {
                            code: m.ErrorCodes.InvalidRequest,
                            message: `Cannot find a nearby ${c.bscPartialPath}. It's needed for formatting.`,
                        }
                    };
                    process_1.default.send(response);
                }
                else {
                    // code will always be defined here, even though technically it can be undefined
                    let code = stupidFileContentCache[params.textDocument.uri];
                    let formattedResult = utils.formatUsingValidBscPath(code, path.join(nodeModulesParentPath, c.bscPartialPath), extension === c.resiExt);
                    if (formattedResult.kind === 'success') {
                        let result = [{
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: Number.MAX_VALUE, character: Number.MAX_VALUE }
                                },
                                newText: formattedResult.result,
                            }];
                        let response = {
                            jsonrpc: c.jsonrpcVersion,
                            id: aa.id,
                            result: result,
                        };
                        process_1.default.send(response);
                        // TODO: make sure the diagnostic diffing takes this into account
                        if (!utils.compilerLogPresentAndNotEmpty(filePath)) {
                            let params2 = {
                                uri: params.textDocument.uri,
                                diagnostics: [],
                            };
                            let notification = {
                                jsonrpc: c.jsonrpcVersion,
                                method: 'textDocument/publishDiagnostics',
                                params: params2,
                            };
                        }
                    }
                    else {
                        let response = {
                            jsonrpc: c.jsonrpcVersion,
                            id: aa.id,
                            result: [],
                        };
                        process_1.default.send(response);
                        if (!utils.compilerLogPresentAndNotEmpty(filePath)) {
                            let filesAndErrors = utils.parseCompilerLogOutput(formattedResult.error, ":");
                            Object.keys(filesAndErrors).forEach(file => {
                                let params2 = {
                                    uri: params.textDocument.uri,
                                    // there's a new optional version param from https://github.com/microsoft/language-server-protocol/issues/201
                                    // not using it for now, sigh
                                    diagnostics: filesAndErrors[file],
                                };
                                let notification = {
                                    jsonrpc: c.jsonrpcVersion,
                                    method: 'textDocument/publishDiagnostics',
                                    params: params2,
                                };
                                process_1.default.send(notification);
                            });
                        }
                    }
                }
            }
        }
        else {
            let response = {
                jsonrpc: c.jsonrpcVersion,
                id: aa.id,
                error: {
                    code: m.ErrorCodes.InvalidRequest,
                    message: "Unrecognized editor request."
                }
            };
            process_1.default.send(response);
        }
    }
});
//# sourceMappingURL=server.js.map