const request = require('request-promise');
const assert = require('assert');
const vscode = require('vscode');

module.exports = ({ url, token }) => {
    const preferences = vscode.workspace.getConfiguration('gitlab-mr');
    const apiVersion = preferences.get('apiVersion', 'v4');

    const gitlab = request.defaults({
        baseUrl: url,
        json: true,
        headers: {
            'PRIVATE-TOKEN': token
        },
        fullResponse: false
    });

    const openMr = (repoId, repoHost, branchName, targetBranch, commitMessage, removeSourceBranch) => {

        return gitlab.post({
            url: `/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests`,
            body: {
                id: repoId,
                source_branch: branchName,
                target_branch: targetBranch,
                title: commitMessage,
                remove_source_branch: removeSourceBranch
            }
        });
    };

    const listMrs = repoId => {
        return gitlab.get({
            url: `/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests`,
            qs: {
                state: 'opened'
            }
        })
        .then(mrs => {
            assert(mrs && mrs.length, 'No MRs found.');

            return mrs;
        });
    };

    return {
        openMr,
        listMrs
    };
};
