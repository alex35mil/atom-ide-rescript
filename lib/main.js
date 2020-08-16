const {
  CompositeDisposable,
  FilesystemChangeEvent,
  TextBuffer,
} = require("atom");
const { AutoLanguageClient, ActiveServer } = require("atom-languageclient");
const path = require("path");

const pkg = require("../package.json");
const diff = require("./diff");

class ReScriptLanguageClient extends AutoLanguageClient {
  getLanguageName() {
    return "ReScript";
  }

  getServerName() {
    return "rescript";
  }

  getGrammarScopes() {
    return ["source.rescript", "rescript"];
  }

  getConnectionType() {
    return "ipc";
  }

  getRootConfigurationKey() {
    return pkg.name;
  }

  constructor() {
    super();
    this.servers = {};
    this.subscriptions = new CompositeDisposable();
    this.formatOnSave =
      atom.config.get("atom-ide-ui.atom-ide-code-format.formatOnSave") || false;
    this.insertFinalNewLine =
      atom.config.get("whitespace.ensureSingleTrailingNewline") || false;

    this.config = {
      languageServerCommand: {
        title: "Language Server Command",
        description:
          "Path to rescript-language-server. " +
          "If not provided, the vendored one will be used.",
        type: ["string", "null"],
        default: null,
        order: 1,
      },
      autocompleteResultsFirst: {
        title: "Show Language Server autocomplete results first",
        description:
          "If checked, Language Server suggestions will be placed before " +
          "the rest of autocomplete results (e.g. snippets etc.). " +
          "Requires restart to take effect.",
        type: "boolean",
        default: true,
        order: 2,
      },
    };
  }

  activate() {
    super.activate();

    require("atom-package-deps").install(pkg.name);

    atom.config.observe(
      "atom-ide-ui.atom-ide-code-format.formatOnSave",
      (value) => {
        this.formatOnSave = value;
      }
    );
    atom.config.observe("whitespace.ensureSingleTrailingNewline", (value) => {
      this.insertFinalNewLine = value;
    });

    this.subscriptions.add(
      atom.commands.add("atom-workspace", {
        [`${pkg.name}:restart-all-servers`]: () =>
          this.restartAllServers().catch(console.error),
      })
    );
  }

  startServerProcess(projectPath) {
    const config = atom.config.get(pkg.name);
    const serverPath = require.resolve(
      config.languageServerCommand ||
        path.join("..", "vendor", "server", "server.js")
    );
    return this.spawnChildNode([serverPath, "--node-ipc"], {
      stdio: [null, null, null, "ipc"],
      cwd: projectPath,
      env: process.env,
    });
  }

  postInitialization(server) {
    this.servers[server.projectPath] = server;
    server.process.on("exit", () => {
      delete this.servers[server.projectPath];
    });
  }

  deactivate() {
    this.subscriptions.dispose();
    return super.deactivate();
  }

  filterChangeWatchedFiles(file) {
    return file.includes("/bsconfig.json") || file.includes("/.merlin");
  }

  provideAutocomplete() {
    const config = atom.config.get(pkg.name);
    return Object.assign(super.provideAutocomplete(), {
      suggestionPriority: config.autocompleteResultsFirst ? 5 : 1,
    });
  }

  async getFileCodeFormat(editor) {
    if (!this.formatOnSave) return [];

    let textBuffer = new TextBuffer({ text: editor.getText() });

    let edits = await super.getFileCodeFormat(editor);

    // Diff text edits for consistent cursor position
    for (const edit of edits) {
      textBuffer.setTextInRange(edit.oldRange, edit.newText, {
        normalizeLineEndings: true,
      });
    }

    // Fix atom-languageclient's format-on-save feature conflicts with insert-final-new-line.
    if (this.insertFinalNewLine && textBuffer.getLastLine() !== "") {
      textBuffer.append("\n", { normalizeLineEndings: true });
    }

    edits = diff(editor.getText(), textBuffer.getText());

    return edits;
  }
}

module.exports = new ReScriptLanguageClient();
