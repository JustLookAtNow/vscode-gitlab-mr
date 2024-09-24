const axios = require('axios');
const assert = require('assert');
const vscode = require('vscode');
const urlModule = require('url');

module.exports = ({ url, token, repoId, repoHost, repoWebProtocol }) => {
    const preferences = vscode.workspace.getConfiguration('gitlab-mr');
    const apiVersion = preferences.get('apiVersion', 'v4');

    const gitlab = axios.create({
        baseURL: url,
        headers: {
            'PRIVATE-TOKEN': token
        }
    });

    // https://docs.gitlab.com/ee/api/projects.html#get-single-project
    const getRepo = () => {
        return gitlab.get(`/api/${apiVersion}/projects/${encodeURIComponent(repoId)}`)
            .then(response => response.data);
    };

    // https://docs.gitlab.com/ee/api/merge_requests.html#create-mr
    const openMr = (branchName, targetBranch, commitMessage, description, removeSourceBranch, squashCommits, assigneeIds, labels) => {
        return gitlab.post(`/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests`, {
            source_branch: branchName,
            target_branch: targetBranch,
            title: commitMessage,
            description: description,
            remove_source_branch: removeSourceBranch,
            squash: squashCommits,
            assignee_ids: assigneeIds,
            labels: labels.join(', ') // GitLab API 接受逗号分隔的标签字符串
        })
            .then(response => response.data);
    };

    // https://docs.gitlab.com/ee/api/merge_requests.html#list-merge-requests
    const listMrs = () => {
        return gitlab.get(`/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests`, {
            params: {
                state: 'opened'
            }
        })
            .then(response => {
                const mrs = response.data;
                assert(mrs && mrs.length, 'No MRs found.');
                return mrs;
            });
    };

    // https://docs.gitlab.com/ee/api/users.html#for-normal-users
    const searchUsers = search => {
        return gitlab.get('/api/v4/users', { // 确保 API 版本一致
            params: {
                search,
                active: true
            }
        })
            .then(response => response.data);
    };

    // https://docs.gitlab.com/ee/api/merge_requests.html#update-mr
    const editMr = (mergeRequestId, body) => {
        return gitlab.put(`/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests/${mergeRequestId}`, body)
            .then(response => response.data);
    };

    // https://docs.gitlab.com/ee/api/merge_request_approvals.html#get-configuration
    const getApprovals = mergeRequestId => {
        return gitlab.get(`/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests/${mergeRequestId}/approvals`)
            .then(response => response.data);
    };

    // https://docs.gitlab.com/ee/api/merge_request_approvals.html#change-allowed-approvers-for-merge-request
    const editApprovers = (mergeRequestId, body) => {
        return gitlab.put(`/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/merge_requests/${mergeRequestId}/approvers`, body)
            .then(response => response.data);
    };

    // https://docs.gitlab.com/ee/api/labels.html#list-project-labels
    const listLabels = () => {
        return gitlab.get(`/api/${apiVersion}/projects/${encodeURIComponent(repoId)}/labels`)
            .then(response => response.data.map(label => label.name));
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
        editApprovers,
        listLabels // 添加 listLabels 函数
    };
};
