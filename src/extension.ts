'use strict';
import * as vscode from 'vscode';
import { RequestPromiseOptions, RequestPromise } from 'request-promise-native';
import rp = require('request-promise-native');
import ASMOutputContentProvider from './ASMOutputContentProvider';


interface CacheEntry<T> {
    readonly entry: T;
    readonly lastUpdated: Date;
}

interface GodboltConfig {
    readonly baseURL: string; //todo url type
    readonly compilerID: string;
}

function CreateConfig(config: vscode.WorkspaceConfiguration): GodboltConfig {
    //todo: error handling
    let godboldConfig = {
        baseURL: config['baseURL'],
        compilerID: config['compiler']
    };
    return godboldConfig;
}
type lineNumber = number | null; //Does TS have an optional<T>?

interface ASM {
    readonly text: string,
    readonly source: lineNumber
}

interface tag {
    readonly line: lineNumber,
    readonly text: string
}

interface CompilerOutput {
    readonly text: String,
    readonly tag: tag
}

interface ExplorerOutput {
    readonly code: number //todo: enum?
    readonly stdout: Array<CompilerOutput>,
    readonly stderr: Array<CompilerOutput>
    readonly asm: Array<ASM>
}

interface Compiler {
    readonly id: string
    readonly name: string,
}

interface QuickPickWithUnderlying<T> extends vscode.QuickPickItem {
    readonly item: T;
}

type Compilers = Array<Compiler>;

type filters = "binary" | "labels" | "intel" | "comments"| "directives"; 

type Source = string;

//Just discovered function interfaces, this could be better as one of them
//lets see how this plays out
interface GodboltCompiler {
    compile(source: Source, compilerID: string): Promise<ExplorerOutput>;
}


function AddResultsToCache<T>(key: string, entry: T, context: vscode.ExtensionContext) {
    const value = {
        entry: entry,
        lastUpdated: new Date()
    } as CacheEntry<T>;
    context.globalState.update(key, value);
}

function AddCompilersToCache(entry: Compilers,  context: vscode.ExtensionContext) {
    AddResultsToCache("compilers", entry, context);
}

//put cache stuff into a file by it self

function GetCompilersFromCache(context: vscode.ExtensionContext) {
    let x = context.globalState.get("compilers") as CacheEntry<Compilers>;
    if(x === undefined) {
        return [];
    }
    const expiryDate = new Date(x.lastUpdated);
    expiryDate.setDate(expiryDate.getDate() + 1);
    if(expiryDate < new Date()) {
        return [];
    }
    return x.entry;
}

function CompileSource<T extends GodboltCompiler>(compiler: T, source: Source, compilerID: string): Promise<ExplorerOutput> { 
    //for now we just want to pass back the results, future will do some manipulation to map it and make pretty :D 
    return compiler.compile(source, compilerID);
}

function GetCompiledResult(source: Source, config: GodboltConfig, compilerID: string) : Promise<ExplorerOutput> {
    let compiler = new HTTPCompiler(config);
    return CompileSource(compiler, source, compilerID);
}

function GetCompilers(context: vscode.ExtensionContext, config: GodboltConfig) : Promise<Compilers> {
    const compilers = GetCompilersFromCache(context);
    if(compilers.length == 0) {
        return rp.get(`${config.baseURL}/compilers`, {           
            headers: {
                'Accept': 'application/json'
            }}).then((compilers) => {
                compilers = JSON.parse(compilers);
                return compilers.map((x) => {
                    return {
                        id: x.id,
                        name: x.name
                    } as Compiler;
                }
            )
        }).then((x) => {
            AddCompilersToCache(x, context);
            return x;
        });
    };
    return Promise.resolve(compilers);
}

class HTTPCompiler implements GodboltCompiler {
    config: GodboltConfig;
    constructor(c: GodboltConfig) {
        this.config = c;
    }
    getOptions(c: GodboltConfig, s: Source): RequestPromiseOptions {
        return {
            headers: {
                'Accept': 'application/json'
            },
            json: true,
            body: {
                source: s,
                options: "",
                'filters[intel]': "true"
            }
             
        }
    }
    getURL(c: GodboltConfig, id: string) : string {
        return `${this.config.baseURL}/compiler/${id}/compile`; //TODO: url builder instead of this
    }
    compile(source: Source, compilerID: string): Promise<ExplorerOutput> {
        return rp.post(this.getURL(this.config, compilerID), this.getOptions(this.config, source)).then((data) => { return (<ExplorerOutput>data) });
    }
}

function GetSelectedText(editor: vscode.TextEditor) : string {
    const selection = editor.selection;
    return editor.document.getText(selection);
}

function GetEntireEditorText(editor: vscode.TextEditor) : string {
    return editor.document.getText();
}

//todo: less arguments
function RunEditorCommand(compiler: Promise<Compilers>, config: GodboltConfig, previewUri: vscode.Uri, provider: ASMOutputContentProvider, GetText:(e: vscode.TextEditor) => string) {
    return () => {
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return; // No open text editor
        }

        compiler.then((x) => x.map(y => { return {
                item: y,
                label: y.name,
                description: ""
            } as QuickPickWithUnderlying<Compiler>
        }))
        .then(x => vscode.window.showQuickPick(x))
        .then(x => {
            if(x == undefined) {
                throw("no user input");
            }
            return GetCompiledResult(GetText(editor), config, x.item.id)
        }).
        then(x => { console.log(x); return x; })
        .then(x => provider.setContent(x.asm.reduce((acc, val) => { return acc + "<br />" + val.text } ,"")))
        .then(() =>  { return vscode.commands.executeCommand('vscode.previewHtml', previewUri, vscode.ViewColumn.Two, `compiler output for something`); });
    }
}

export function activate(context: vscode.ExtensionContext) {
    let config = CreateConfig(vscode.workspace.getConfiguration('godbolt'));
    const compiler = GetCompilers(context, config);
    const previewUri = vscode.Uri.parse('asm-preview://authority/asm-preview');
    const provider = new ASMOutputContentProvider();
	const registration = vscode.workspace.registerTextDocumentContentProvider('asm-preview', provider);
    const selectionDisposable = vscode.commands.registerCommand('extension.exploreCompilersSelection', RunEditorCommand(compiler, config, previewUri, provider, GetSelectedText));
    const documentDisposable = vscode.commands.registerCommand('extension.exploreCompilersFile', RunEditorCommand(compiler, config, previewUri, provider, GetEntireEditorText));
    context.subscriptions.push(selectionDisposable);
    context.subscriptions.push(documentDisposable);
}

// this method is called when your extension is deactivated
export function deactivate() {  

}