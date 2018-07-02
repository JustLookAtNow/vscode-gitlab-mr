const vscode = require('vscode');
const workflows = require('./src/workflows');

exports.activate = context => {
    const openMR = vscode.commands.registerCommand('extension.openMR', workflows.openMR);
    const viewMR = vscode.commands.registerCommand('extension.viewMR', workflows.viewMR);
    const checkoutMR = vscode.commands.registerCommand('extension.checkoutMR', workflows.checkoutMR);
    const editMR = vscode.commands.registerCommand('extension.editMR', workflows.editMR);

    context.subscriptions.push(openMR);
    context.subscriptions.push(viewMR);
    context.subscriptions.push(checkoutMR);
    context.subscriptions.push(editMR);
};

exports.deactivate = () => {};
