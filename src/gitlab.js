const request = require('request-promise');
const assert = require('assert');
const vscode = require('vscode');
const urlModule = require('url');

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

    // https://docs.gitlab.com/ee/api/projects.html#get-single-project
    const getRepo = () => {
        return gitlab.get({
            url: `/api/${apiVersion}/projects/${encodeURIComponent(repoId)}`
        });
    };

    // https://docs.gitlab.com/ee/api/merge_requests.html#create-mr
    const openMr = (branchName, targetBranch, commitMessage, description, removeSourceBranch, squashCommits) => {
        return gitlab.post({
            url: `/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests`,
            body: {
                id: repoId,
                source_branch: branchName,
                target_branch: targetBranch,
                title: commitMessage,
                description: description,
                remove_source_branch: removeSourceBranch,
                squash: squashCommits
            }
        });
    };

    // https://docs.gitlab.com/ee/api/merge_requests.html#list-merge-requests
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

    // https://docs.gitlab.com/ee/api/users.html#for-normal-users
    const searchUsers = search => {
        return gitlab.get({
            url: `/api/${apiVersion}/users`,
            qs: {
                search,
                active: true
            }
        });
    };

    // https://docs.gitlab.com/ee/api/merge_requests.html#update-mr
    const editMr = (mergeRequestId, body) => {
        return gitlab.put({
            url: `/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests/${mergeRequestId}`,
            body
        });
    };

    // https://docs.gitlab.com/ee/api/merge_request_approvals.html#get-configuration
    const getApprovals = mergeRequestId => {
        return gitlab.get({
            url: `/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests/${mergeRequestId}/approvals`
        });
    };

    // https://docs.gitlab.com/ee/api/merge_request_approvals.html#change-allowed-approvers-for-merge-request
    const editApprovers = (mergeRequestId, body) => {
        return gitlab.put({
            url: `/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests/${mergeRequestId}/approvers`,
            body
        });
    };

    const buildMrUrl = (branch, targetBranch) => {
        return urlModule.format({
            protocol: repoWebProtocol,
            host: repoHost,
            pathname: `${repoId}/merge_requests/new`,
            query: {
                'merge_request[source_branch]': branch,
                'merge_request[target_branch]': targetBranch
            }
        });
    };

    
    const buildExistMrUrl = mrId => {
        return urlModule.format({
            protocol: repoWebProtocol,
            host: repoHost,
            pathname: `${repoId}/merge_requests/${mrId}`
        });
    };

    return {
        getRepo,
        openMr,
        listMrs,
        editMr,
        buildMrUrl,
        buildExistMrUrl,
        searchUsers,
        getApprovals,
        editApprovers
    };
};
