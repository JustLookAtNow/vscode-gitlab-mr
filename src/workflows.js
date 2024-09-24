const vscode = require('vscode');
const open = require('opn');
const url = require('url');

const gitActions = require('./git');
const gitlabActions = require('./gitlab');
const gitUtils = require('./git-utils');

const message = msg => `Gitlab MR: ${msg}`;
const ERROR_STATUS = message('Unable to create MR.');
const STATUS_TIMEOUT = 10000;
const WIP_STRING = 'WIP:';
const CONFIG_NAMESPACE = 'gitlab-mr';

const showErrorMessage = msg => {
    vscode.window.showErrorMessage(message(msg));
    vscode.window.setStatusBarMessage(ERROR_STATUS, STATUS_TIMEOUT);
};

const showAccessTokenErrorMessage = gitlabApiUrl => {
    const tokenUrl = `${gitlabApiUrl}/profile/personal_access_tokens`;
    const errorMsg = gitlabApiUrl === 'https://gitlab.com' ?
        'gitlab-mr.accessToken preference not set.' :
        `gitlab-mr.accessTokens["${gitlabApiUrl}"] preference not set.`;

    const generateTokenLabel = 'Generate Access Token';

    return vscode.window.showErrorMessage(message(errorMsg), generateTokenLabel).then(selected => {
        switch (selected) {
            case generateTokenLabel:
                open(tokenUrl);
                break;
        }
    });
};

const selectWorkspaceFolder = async () => {
    if (vscode.workspace.workspaceFolders.length > 1) {
        const selected = await vscode.window.showQuickPick(vscode.workspace.workspaceFolders.map(folder => ({
            label: folder.name,
            folder
        })), {
            placeHolder: 'Select workspace folder',
            ignoreFocusOut: true
        });

        if (selected) {
            return selected.folder;
        }
    } else {
        return vscode.workspace.workspaceFolders[0];
    }
};

const buildGitlabContext = async workspaceFolderPath => {
    const preferences = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const targetRemote = preferences.get('targetRemote', 'origin');

    // Access tokens
    const gitlabComAccessToken = preferences.get('accessToken');
    const gitlabCeAccessTokens = preferences.get('accessTokens') || {};

    // Set git context
    const git = buildGitContext(workspaceFolderPath);

    const { repoId, repoHost } = await git.parseRemotes(targetRemote);
    const gitlabHosts = gitUtils.parseGitlabHosts(gitlabCeAccessTokens);
    const repoWebProtocol = gitUtils.parseRepoProtocol(repoHost, gitlabHosts);

    const gitlabApiUrl = url.format({
        host: repoHost,
        protocol: repoWebProtocol
    });
    const isGitlabCom = repoHost === 'gitlab.com';
    const accessToken = isGitlabCom ? gitlabComAccessToken : gitlabCeAccessTokens[gitlabApiUrl];

    // Token not set for repo host
    if (!accessToken) {
        return showAccessTokenErrorMessage(gitlabApiUrl);
    }

    // Build Gitlab context
    return gitlabActions({
        url: gitlabApiUrl,
        token: accessToken,
        repoId,
        repoHost,
        repoWebProtocol
    });
};

const buildGitContext = workspaceFolderPath => gitActions(workspaceFolderPath);

// 引入必要的 VSCode 模块
const { ViewColumn } = require('vscode');

// 添加一个新的函数来显示自定义表单
const showCreateMRForm = async () => {
    // 获取当前工作区文件夹
    const workspaceFolder = await selectWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const workspaceFolderPath = workspaceFolder.uri.fsPath;
    const git = buildGitContext(workspaceFolderPath);
    const preferences = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const targetRemote = preferences.get('targetRemote', 'origin');
    
    // 获取所有远程分支名称
    const branchSummary = await git.listBranches(targetRemote);
    const branches = Object.keys(branchSummary.branches).map(branch => branchSummary.branches[branch].name);

    // 获取当前分支名称
    const currentBranch = await git.getCurrentBranch();

    // 获取上次使用的目标分支
    const lastTargetBranch = preferences.get('targetBranch', 'master');

    // 获取最后一次提交消息
    const lastCommitMessage = await git.lastCommitMessage();

    // 获取删除源分支的配置
    const removeSourceBranch = preferences.get('removeSourceBranch', false);

    // 获取上次使用的受让人
    const lastAssignees = preferences.get('lastAssignees', []);

    // 获取存储的标签
    const storedLabels = preferences.get('projectLabels', []);

    const panel = vscode.window.createWebviewPanel(
        'createMR', // 视图类型
        '创建 Merge Request', // 标题
        ViewColumn.One, // 显示在编辑器的哪个面板
        {
            enableScripts: true
        }
    );

    // 设置 Webview 的 HTML 内容，并传递分支列表、当前分支、最后一次提交信息、默认 assignees 和 labels
    panel.webview.html = getWebviewContent(branches, currentBranch, lastTargetBranch, lastCommitMessage, removeSourceBranch, lastAssignees, storedLabels);

    // 处理来自 Webview 的消息
    panel.webview.onDidReceiveMessage(async message => {
        switch (message.command) {
            case 'submit':
                const { branch, targetBranch, mrTitle, description, deleteSourceBranch, squashCommits, assigneeIds, labels } = message;
                await openMR(branch, targetBranch, mrTitle, description, deleteSourceBranch, squashCommits, assigneeIds, labels);
                panel.dispose();
                break;
            case 'fetchAssignees':
                await handleFetchAssignees(message.query, panel);
                break;
            case 'refreshLabels':
                await handleRefreshLabels(panel);
                break;
            case 'cancel':
                panel.dispose();
                break;
        }
    });
};

// 添加处理 fetchAssignees 消息的函数
const handleFetchAssignees = async (query, panel) => {
    const workspaceFolder = await selectWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const workspaceFolderPath = workspaceFolder.uri.fsPath;
    const gitlab = await buildGitlabContext(workspaceFolderPath);

    try {
        const users = await gitlab.searchUsers(query);
        panel.webview.postMessage({ command: 'provideAssignees', assignees: users });
    } catch (error) {
        panel.webview.postMessage({ command: 'provideAssignees', assignees: [] });
    }
};

// 添加处理 refreshLabels 消息的函数
const handleRefreshLabels = async panel => {
    const workspaceFolder = await selectWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const workspaceFolderPath = workspaceFolder.uri.fsPath;
    const gitlab = await buildGitlabContext(workspaceFolderPath);

    try {
        const labels = await gitlab.listLabels();
        // 存储标签到配置
        await vscode.workspace.getConfiguration('gitlab-mr').update('projectLabels', labels, vscode.ConfigurationTarget.Workspace);
        panel.webview.postMessage({ command: 'provideLabels', labels });
    } catch (error) {
        console.error('Error fetching labels:', error);
        panel.webview.postMessage({ command: 'provideLabels', labels: [] });
    }
};

// 修改获取 Webview 内容的函数，添加分支的下拉菜单和预填充MR标题
const getWebviewContent = (branches, currentBranch, lastTargetBranch, lastCommitMessage, removeSourceBranch, lastAssignees = [], storedLabels = []) => {
    return `<!DOCTYPE html>
    <html lang="zh">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
        <title>创建 Merge Request</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f5f5f5;
                padding: 20px;
                margin: 0;
            }
            form {
                background-color: #ffffff;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                max-width: 500px;
                margin: auto;
            }
            label {
                display: block;
                margin-top: 15px;
                font-weight: bold;
                color: #333333;
            }
            input[type="text"],
            textarea {
                width: 100%;
                padding: 10px;
                margin-top: 5px;
                border: 1px solid #cccccc;
                border-radius: 4px;
                box-sizing: border-box;
                font-size: 14px;
                transition: border-color 0.3s;
            }
            input[type="text"]:focus,
            textarea:focus {
                border-color: #66afe9;
                outline: none;
            }
            .autocomplete-wrapper {
                position: relative;
            }
            .suggestions {
                position: absolute;
                background-color: #ffffff;
                border: 1px solid #cccccc;
                border-top: none;
                z-index: 1000;
                max-height: 150px;
                overflow-y: auto;
                width: 100%;
                box-sizing: border-box;
                border-radius: 0 0 4px 4px;
            }
            .suggestion-item {
                padding: 10px;
                cursor: pointer;
                font-size: 14px;
                color: #333333;
            }
            .suggestion-item:hover,
            .suggestion-item.active {
                background-color: #f0f0f0;
            }
            .checkbox-group {
                display: flex;
                align-items: center;
                margin-top: 15px;
            }
            .checkbox-group input {
                width: auto;
                margin-right: 10px;
            }
            button {
                padding: 10px 20px;
                margin-top: 20px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                transition: background-color 0.3s;
            }
            button[type="submit"] {
                background-color: #28a745;
                color: #ffffff;
                margin-right: 10px;
            }
            button[type="submit"]:hover {
                background-color: #218838;
            }
            button[type="button"] {
                background-color: #dc3545;
                color: #ffffff;
            }
            button[type="button"]:hover {
                background-color: #c82333;
            }
            .checkbox-label {
                margin-top: 0px;
            }
            .tag {
                display: inline-block;
                background-color: #e0e0e0;
                border-radius: 4px;
                padding: 2px 8px;
                margin: 2px;
            }
            .tag button {
                background: none;
                border: none;
                cursor: pointer;
                margin-left: 4px;
            }
            .multi-select-wrapper {
                position: relative;
            }
            select[multiple] {
                width: 100%;
                padding: 10px;
                margin-top: 5px;
                border: 1px solid #cccccc;
                border-radius: 4px;
                box-sizing: border-box;
                font-size: 14px;
                transition: border-color 0.3s;
                height: 100px;
            }
            select[multiple]:focus {
                border-color: #66afe9;
                outline: none;
            }
            #refreshLabels {
                position: absolute;
                top: 10px;
                right: 10px;
                background-color: #007bff;
                color: #ffffff;
                border: none;
                border-radius: 4px;
                padding: 5px 10px;
                cursor: pointer;
            }
            #refreshLabels:hover {
                background-color: #0056b3;
            }
        </style>
    </head>
    <body>
        <form id="mrForm">
            <label for="branch">源分支:</label>
            <input type="text" id="branch" name="branch" value="${currentBranch}" required readonly>

            <label for="targetBranch">目标分支:</label>
            <div class="autocomplete-wrapper">
                <input type="text" id="targetBranch" name="targetBranch" value="${lastTargetBranch}" required placeholder="选择或输入目标分支" autocomplete="off">
                <div id="suggestions" class="suggestions" style="display: none;"></div>
            </div>

            <label for="mrTitle">MR 标题:</label>
            <input type="text" id="mrTitle" name="mrTitle" value="${lastCommitMessage}" required>

            <label for="description">描述:</label>
            <textarea id="description" name="description" rows="4" placeholder="填写MR的描述..."></textarea>

            <div class="checkbox-group">
                <input type="checkbox" id="deleteSourceBranch" name="deleteSourceBranch" ${removeSourceBranch ? 'checked' : ''}>
                <label class="checkbox-label" for="deleteSourceBranch">是否删除源分支</label>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="squashCommits" name="squashCommits">
                <label class="checkbox-label" for="squashCommits">是否压缩提交</label>
            </div>

            <label for="assignees">受让人:</label>
            <div class="autocomplete-wrapper">
                <input type="text" id="assignees" name="assignees" placeholder="输入用户名并选择" autocomplete="off">
                <div id="assigneeSuggestions" class="suggestions" style="display: none;"></div>
            </div>
            <div id="selectedAssignees">
                ${lastAssignees.map(assignee => `<span class="tag">${assignee.name} <button type="button" data-id="${assignee.id}">x</button></span>`).join('')}
            </div>

            <label for="labels">标签:</label>
            <div class="multi-select-wrapper">
                <select id="labels" name="labels" multiple>
                    ${storedLabels.map(label => `<option value="${label}">${label}</option>`).join('')}
                </select>
                <button type="button" id="refreshLabels">刷新标签</button>
            </div>

            <button type="submit">提交</button>
            <button type="button" onclick="cancel()">取消</button>
        </form>

        <script>
            const vscode = acquireVsCodeApi();
            const branches = ${JSON.stringify(branches)};
            const assignees = ${JSON.stringify(lastAssignees)};
            const labels = ${JSON.stringify(storedLabels)};

            const targetBranchInput = document.getElementById('targetBranch');
            const suggestionsBox = document.getElementById('suggestions');
            let currentFocus = -1;

            // 简单的模糊匹配函数
            const fuzzyMatch = (query, branch) => {
                query = query.toLowerCase();
                branch = branch.toLowerCase();
                let qIndex = 0;
                for (let i = 0; i < branch.length; i++) {
                    if (branch[i] === query[qIndex]) {
                        qIndex++;
                    }
                    if (qIndex === query.length) {
                        return true;
                    }
                }
                return false;
            };

            targetBranchInput.addEventListener('input', function() {
                const query = this.value.trim().toLowerCase();
                suggestionsBox.innerHTML = '';
                currentFocus = -1;
                if (query.length === 0) {
                    suggestionsBox.style.display = 'none';
                    return;
                }
                const filteredBranches = branches.filter(branch => fuzzyMatch(query, branch));
                if (filteredBranches.length === 0) {
                    suggestionsBox.style.display = 'none';
                    return;
                }
                filteredBranches.forEach(branch => {
                    const div = document.createElement('div');
                    div.className = 'suggestion-item';
                    div.textContent = branch;
                    div.addEventListener('click', () => {
                        targetBranchInput.value = branch;
                        suggestionsBox.style.display = 'none';
                    });
                    suggestionsBox.appendChild(div);
                });
                suggestionsBox.style.display = 'block';
            });

            // 键盘导航
            targetBranchInput.addEventListener('keydown', function(e) {
                const items = suggestionsBox.getElementsByClassName('suggestion-item');
                if (e.key === 'ArrowDown') {
                    currentFocus++;
                    addActive(items);
                    e.preventDefault();
                } else if (e.key === 'ArrowUp') {
                    currentFocus--;
                    addActive(items);
                    e.preventDefault();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (currentFocus > -1) {
                        if (items) items[currentFocus].click();
                    }
                }
            });

            function addActive(items) {
                if (!items) return false;
                removeActive(items);
                if (currentFocus >= items.length) currentFocus = 0;
                if (currentFocus < 0) currentFocus = items.length - 1;
                items[currentFocus].classList.add('active');
                // 确保当前选中的项在视野内
                items[currentFocus].scrollIntoView({ block: 'nearest' });
            }

            function removeActive(items) {
                for (let i = 0; i < items.length; i++) {
                    items[i].classList.remove('active');
                }
            }

            // 点击页面其他地方隐藏建议列表
            document.addEventListener('click', function(event) {
                if (!targetBranchInput.contains(event.target) && !suggestionsBox.contains(event.target)) {
                    suggestionsBox.style.display = 'none';
                }
            });

            // 处理受让人输入和选择
            const assigneeInput = document.getElementById('assignees');
            const assigneeSuggestions = document.getElementById('assigneeSuggestions');
            const selectedAssigneesContainer = document.getElementById('selectedAssignees');
            let selectedAssignees = ${JSON.stringify(lastAssignees)};

            // 防止 Enter 键提交表单
            assigneeInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                }
            });

            // 添加防抖功能
            let debounceTimer;
            assigneeInput.addEventListener('input', function() {
                const query = this.value.trim().toLowerCase();
                assigneeSuggestions.innerHTML = '';
                if (query.length === 0) {
                    assigneeSuggestions.style.display = 'none';
                    return;
                }

                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    // 发送消息请求匹配用户
                    vscode.postMessage({ command: 'fetchAssignees', query });
                }, 500); // 延迟 0.5 秒
            });

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'provideAssignees') {
                    assigneeSuggestions.innerHTML = '';
                    if (message.assignees.length === 0) {
                        assigneeSuggestions.style.display = 'none';
                        return;
                    }
                    message.assignees.forEach(assignee => {
                        const div = document.createElement('div');
                        div.className = 'suggestion-item';
                        div.textContent = assignee.name + '(@' + assignee.username + ')';
                        div.addEventListener('click', () => {
                            selectedAssignees.push(assignee);
                            renderSelectedAssignees();
                            assigneeInput.value = '';
                            assigneeSuggestions.style.display = 'none';
                        });
                        assigneeSuggestions.appendChild(div);
                    });
                    assigneeSuggestions.style.display = 'block';
                } else if (message.command === 'provideLabels') {
                    const labelsSelect = document.getElementById('labels');
                    labelsSelect.innerHTML = message.labels.map(label => '<option value="' + label + '">' + label + '</option>').join('');
                }
            });

            function renderSelectedAssignees() {
                selectedAssigneesContainer.innerHTML = selectedAssignees.map(a => '<span class="tag">' + a.name + ' <button type="button" data-id="' + a.id + '">x</button></span>').join('');
                attachAssigneeRemoveHandlers();
            }

            function attachAssigneeRemoveHandlers() {
                document.querySelectorAll('#selectedAssignees button').forEach(button => {
                    button.addEventListener('click', () => {
                        const id = button.getAttribute('data-id');
                        selectedAssignees = selectedAssignees.filter(a => a.id !== id);
                        renderSelectedAssignees();
                    });
                });
            }

            // 处理标签刷新
            document.getElementById('refreshLabels').addEventListener('click', () => {
                vscode.postMessage({ command: 'refreshLabels' });
            });

            document.getElementById('mrForm').addEventListener('submit', event => {
                event.preventDefault();
                const branch = document.getElementById('branch').value.trim();
                const targetBranch = document.getElementById('targetBranch').value.trim();
                const mrTitle = document.getElementById('mrTitle').value.trim();
                const description = document.getElementById('description').value.trim();
                const deleteSourceBranch = document.getElementById('deleteSourceBranch').checked;
                const squashCommits = document.getElementById('squashCommits').checked;
                const assigneeIds = selectedAssignees.map(a => a.id);
                const labels = Array.from(document.getElementById('labels').selectedOptions).map(option => option.value);
                vscode.postMessage({
                    command: 'submit',
                    branch,
                    targetBranch,
                    mrTitle,
                    description,
                    deleteSourceBranch,
                    squashCommits,
                    assigneeIds,
                    labels
                });
            });

            function cancel() {
                vscode.postMessage({ command: 'cancel' });
            }

            // 初始化选中的受让人
            renderSelectedAssignees();
        </script>
    </body>
    </html>`;
};

// 修改 openMR 函数以处理 new parameters: assigneeIds 和 labels
const openMR = async (branch, targetBranch, mrTitle, description, deleteSourceBranch, squashCommits, assigneeIds, labels) => {
    const preferences = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);

    const targetRemote = preferences.get('targetRemote', 'origin');
    const autoCommitChanges = preferences.get('autoCommitChanges', false);
    const autoOpenMr = preferences.get('autoOpenMr', false);
    const openToEdit = preferences.get('openToEdit', false);
    
    // Pick workspace
    const workspaceFolder = await selectWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const workspaceFolderPath = workspaceFolder.uri.fsPath;

    // Set git context
    const git = buildGitContext(workspaceFolderPath);

    const gitlab = await buildGitlabContext(workspaceFolderPath);

    // Validate branch name
    if (branch === '') {
        return showErrorMessage('Branch name must be provided.');
    }

    if (branch.indexOf(' ') > -1) {
        return showErrorMessage('Branch name must not contain spaces.');
    }

    const { onMaster, cleanBranch } = await git.checkStatus(branch);

    if (branch === targetBranch) {
        return showErrorMessage(`Target branch name cannot be same with origin branch (${targetBranch}).`);
    }

    const buildStatus = vscode.window.setStatusBarMessage(message(`Building MR to ${targetBranch} from ${branch}...`));
    
    // If the branch is not clean, and autoCommitChanges is false,
    // prompt user if they want to commit changes.
    // Otherwise, commit changes.
    const commitChanges = !cleanBranch && !autoCommitChanges ? (
        await vscode.window.showQuickPick([
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ], {
            placeHolder: 'Commit current changes?',
            ignoreFocusOut: true
        })
            .then(selection => selection && selection.value)
    ) : true;

    if (commitChanges === undefined) {
        return;
    }

    // Build up chain of git commands to run
    let gitPromises;
    if (!onMaster) {
        if (cleanBranch || !commitChanges) {
            gitPromises = git.createBranch(branch)
                .then(() => git.pushBranch(targetRemote, branch));
        } else {
            gitPromises = git.createBranch(branch)
                .then(() => git.addFiles('./*'))
                .then(() => git.commitFiles(mrTitle))
                .then(() => git.pushBranch(targetRemote, branch));
        }
    } else {
        if (cleanBranch || !commitChanges) {
            gitPromises = git.pushBranch(targetRemote, branch);
        } else {
            gitPromises = git.addFiles('./*')
                .then(() => git.commitFiles(mrTitle))
                .then(() => git.pushBranch(targetRemote, branch));
        }
    }

    await gitPromises
        .catch(err => {
            buildStatus.dispose();
            throw err;
        });

    return gitlab.openMr(branch, targetBranch, mrTitle, description, deleteSourceBranch, squashCommits, assigneeIds, labels)
        .then(mr => {
            // 更新配置中的 targetBranch
            preferences.update('targetBranch', targetBranch, vscode.ConfigurationTarget.Workspace);

            const successMessage = message(`MR !${mr.iid} 创建成功。`);
            const successButton = '打开 MR';

            buildStatus.dispose();
            vscode.window.setStatusBarMessage(successMessage, STATUS_TIMEOUT);

            const mrWebUrl = `${mr.web_url}${openToEdit ? '/edit' : ''}`;

            if (autoOpenMr) {
                vscode.env.openExternal(vscode.Uri.parse(mrWebUrl));
                return vscode.window.showInformationMessage(successMessage);
            }

            return vscode.window.showInformationMessage(successMessage, successButton).then(selected => {
                switch (selected) {
                    case successButton: {
                        vscode.env.openExternal(vscode.Uri.parse(mrWebUrl));
                        break;
                    }
                }
            });
        })
        .catch(err => {
            // showErrorMessage(err.message);
            buildStatus.dispose();

            let mrUrl = gitlab.buildMrUrl(branch, targetBranch);

            let createButton = 'Create on Gitlab';

            if (err.statusCode === 409) {
                // 重复创建
                createButton = 'Open exist MR on Gitlab';
                // 从错误消息中提取 MR ID
                const mrId = err.message.match(/!(\d+)/)[1];
                mrUrl = gitlab.buildExistMrUrl(mrId);

            }
            vscode.window.setStatusBarMessage(ERROR_STATUS, STATUS_TIMEOUT);
            vscode.window.showErrorMessage(err.message, createButton).then(selected => {
                switch (selected) {
                    case createButton:
                        vscode.env.openExternal(vscode.Uri.parse(mrUrl));
                        break;
                }
            });
        });
};

const listMRs = async workspaceFolderPath => {
    const preferences = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);

    const targetBranch = preferences.get('targetBranch', 'master');

    const gitlab = await buildGitlabContext(workspaceFolderPath);
    const mrs = await gitlab.listMrs();

    const mrList = mrs.map(mr => {
        const label = `MR !${mr.iid}: ${mr.title}`;
        const detail = mr.description;
        let description = `${mr.source_branch}`;

        if (mr.target_branch !== targetBranch) {
            description += ` > ${mr.target_branch}`;
        }

        return {
            mr,
            label,
            detail,
            description
        };
    });

    const selected = await vscode.window.showQuickPick(mrList, {
        matchOnDescription: true,
        placeHolder: 'Select MR',
        ignoreFocusOut: true
    });

    if (selected) {
        return selected.mr;
    }
};

const viewMR = async () => {
    const workspaceFolder = await selectWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const mr = await listMRs(workspaceFolder.uri.fsPath);
    if (!mr) {
        return;
    }

    vscode.env.openExternal(vscode.Uri.parse(mr.web_url));
};

const checkoutMR = async () => {
    const preferences = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const targetRemote = preferences.get('targetRemote', 'master');

    const workspaceFolder  = await selectWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const workspaceFolderPath = workspaceFolder.uri.fsPath;

    const mr = await listMRs(workspaceFolderPath);
    if (!mr) {
        return;
    }

    const git = buildGitContext(workspaceFolderPath);

    const checkoutStatus = vscode.window.setStatusBarMessage(message(`Checking out MR !${mr.iid}...`));

    return git.listBranches()
        .then(async branches => {
            const branchName = mr.source_branch;
            const targetBranch = branches.branches[branchName];

            if (targetBranch) {
                // Switch to existing branch
                return git.checkoutBranch([branchName]);
            }

            // Fetch and switch to remote branch
            await git.fetchRemote(targetRemote, branchName);
            return git.checkoutBranch(['-b', branchName, `${targetRemote}/${branchName}`]);
        })
        .then(() => {
            checkoutStatus.dispose();
            vscode.window.setStatusBarMessage(message(`Switched to MR !${mr.iid}.`), STATUS_TIMEOUT);
        })
        .catch(err => {
            checkoutStatus.dispose();
            showErrorMessage(err.message);
        });
};

const searchUsers = async gitlab => {
    const search = await vscode.window.showInputBox({
        placeHolder: 'Search for user...',
        ignoreFocusOut: true
    });

    if (search) {
        const users = await gitlab.searchUsers(search);

        if (users) {
            const userOptions = users.map(user => ({
                label: `${user.name} (${user.username})`,
                user
            }));

            const otherOptions = [
                { label: 'Search again...', searchAgain: true }
            ];

            const selection = await vscode.window.showQuickPick([
                ...userOptions,
                ...otherOptions
            ], {
                placeHolder: 'Select a user...'
            });

            if (selection.searchAgain) {
                return searchUsers(gitlab);
            }

            return selection;
        }
    }
};

const editMR = async () => {
    const workspaceFolder = await selectWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const workspaceFolderPath = workspaceFolder.uri.fsPath;
    const mr = await listMRs(workspaceFolderPath);
    if (!mr) {
        return;
    }

    const gitlab = await buildGitlabContext(workspaceFolderPath);

    const editCommands = {
        editTitle: 'Edit title',
        setWip: mr.work_in_progress ? 'Remove WIP' : 'Set as WIP',
        editAssignee: mr.assignee ? `Edit assignee (${mr.assignee.username})`: 'Set assignee',
        removeAssignee: `Remove assignee ${mr.assignee ? `(${mr.assignee.username})` : ''}`,
        addApprovers: 'Add approvers'
    };

    const selected = await vscode.window.showQuickPick(Object.values(editCommands), {
        placeHolder: 'Select an action...',
        ignoreFocusOut: true
    });

    const showGitlabError = e => {
        showErrorMessage(e.error.error || e.error.message);
    };

    switch (selected) {
        case editCommands.editTitle:
            const title = await vscode.window.showInputBox({
                value: mr.title
            });

            if (title) {
                return gitlab.editMr(mr.iid, {
                    title
                })
                    .then(() => vscode.window.showInformationMessage(message(`MR !${mr.iid} title updated.`)))
                    .catch(showGitlabError);
            }
            break;

        case editCommands.setWip:
            return gitlab.editMr(mr.iid, {
                title: mr.work_in_progress ? mr.title.split(WIP_STRING)[1].trim() : `${WIP_STRING} ${mr.title}`
            })
                .then(updatedMr => vscode.window.showInformationMessage(message(`MR !${mr.iid} WIP ${updatedMr.work_in_progress ? 'added' : 'removed'}.`)))
                .catch(showGitlabError);

        case editCommands.editAssignee:
            const assignee = await searchUsers(gitlab);
            if (assignee) {
                return gitlab.editMr(mr.iid, {
                    assignee_id: assignee.user.id
                })
                    .then(() => vscode.window.showInformationMessage(message(`MR !${mr.iid} assignee set to ${assignee.user.username}`)))
                    .catch(showGitlabError);
            }
            break;

        case editCommands.removeAssignee:
            return gitlab.editMr(mr.iid, {
                assignee_id: null
            })
                .then(() => vscode.window.showInformationMessage(message(`MR !${mr.iid} assignee removed.`)))
                .catch(showGitlabError);

        case editCommands.addApprovers:
            const approvals = await gitlab.getApprovals(mr.iid);
            const approver = await searchUsers(gitlab);
            if (approver) {
                return gitlab.editApprovers(mr.iid, {
                    approver_ids: [
                        ...approvals.approvers.map(app => app.user.id),
                        approver.user.id
                    ],
                    approver_group_ids: [
                        ...approvals.approver_groups.map(app => app.group.id)
                    ]
                })
                    .then(() => vscode.window.showInformationMessage(message(`MR !${mr.iid} approver added.`)))
                    .catch(showGitlabError);
            }
            break;

        default:
            break;
    }
};

module.exports = {
    listMRs: () => listMRs().catch(e => showErrorMessage(e.message)),
    viewMR: () => viewMR().catch(e => showErrorMessage(e.message)),
    checkoutMR: () => checkoutMR().catch(e => showErrorMessage(e.message)),
    openMR: showCreateMRForm,
    editMR: () => editMR().catch(e => showErrorMessage(e.message))
};
