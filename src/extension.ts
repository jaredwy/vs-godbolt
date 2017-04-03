'use strict';
import * as vscode from 'vscode';
import { RequestPromiseOptions, RequestPromise } from 'request-promise-native';
import rp = require('request-promise-native');

import ASMOutputContentProvider from './ASMOutputContentProvider';

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

type filters = "binary" | "labels" | "intel" | "comments"| "directives"; 

type Source = string;

//Just discovered function interfaces, this could be better as one of them
//lets see how this plays out
interface GodboltCompiler {
    compile(source: Source): Promise<ExplorerOutput>;
}


function CompileSource<T extends GodboltCompiler>(compiler: T, source: Source): Promise<ExplorerOutput> { 
    //for now we just want to pass back the results, future will do some manipulation to map it and make pretty :D 
    return compiler.compile(source);
}

function GetCompiledResult(source: Source) : Promise<ExplorerOutput> {
    let config = CreateConfig(vscode.workspace.getConfiguration('godbolt'));
    let compiler = new HTTPCompiler(config);
    return CompileSource(compiler, source);
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
    getURL(c: GodboltConfig) : string {
        return `${this.config.baseURL}/compiler/${this.config.compilerID}/compile`; //TODO: url builder instead of this
    }
    compile(source: Source): Promise<ExplorerOutput> {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        return rp.post(this.getURL(this.config), this.getOptions(this.config, source)).then((data) => { return (<ExplorerOutput>data) });
    }
}



export function activate(context: vscode.ExtensionContext) {
    let previewUri = vscode.Uri.parse('asm-preview://authority/asm-preview');
	let provider = new ASMOutputContentProvider();
	let registration = vscode.workspace.registerTextDocumentContentProvider('asm-preview', provider);
    let selectionDisposable = vscode.commands.registerCommand('extension.exploreCompilersSelection', () => {
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return; // No open text editor
        }
        let selection = editor.selection;
        let text = editor.document.getText(selection);
        GetCompiledResult(text).then((data) => {
            provider.setContent(data.asm.reduce((acc, val) => { return acc + "<br />" + val.text } ,""));
        }).then(() =>  { return vscode.commands.executeCommand('vscode.previewHtml', previewUri, vscode.ViewColumn.Two, 'ASM output'); });
    });

    let documentDisposable = vscode.commands.registerCommand('extension.exploreCompilersFile', () => {
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return; // No open text editor
        }
        let text = editor.document.getText();
        GetCompiledResult(text).then((data) => {
            provider.setContent(data.asm.reduce((acc, val) => { return acc + "<br />" + val.text } ,""));
        }).then(() =>  { return vscode.commands.executeCommand('vscode.previewHtml', previewUri, vscode.ViewColumn.Two, 'ASM output'); });
    });



    context.subscriptions.push(selectionDisposable);
    context.subscriptions.push(documentDisposable);
}

// this method is called when your extension is deactivated
export function deactivate() {
}