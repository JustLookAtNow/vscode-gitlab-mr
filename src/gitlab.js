const request = require('request-promise');
const assert = require('assert');
const vscode = require('vscode');

module.exports = ({ url, token, repoId, repoHost, repoWebProtocol }) => {
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

    const openMr = (repoHost, branchName, targetBranch, commitMessage, removeSourceBranch) => {
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

    const listMrs = () => {
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

    // https://gitlab.com/gitlab-org/gitlab-ce/blob/8-16-stable/doc/api/merge_requests.md#update-mr
    const editMr = (mergeRequestId, body) => {
        return gitlab.put({
            url: `/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests/${mergeRequestId}`,
            body
        });
    };

    const buildMrUrl = (branch, targetBranch) => {
        return url.format({
            protocol: repoWebProtocol,
            host: repoHost,
            pathname: `${repoId}/merge_requests/new`,
            query: {
                'merge_request[source_branch]': branch,
                'merge_request[target_branch]': targetBranch
            }
        });
    };

    return {
        openMr,
        listMrs,
        editMr,
        buildMrUrl
    };
};
