const request = require('request-promise');
const assert = require('assert');

module.exports = ({ url, token }) => {
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
            url: `/api/v4/projects/${encodeURIComponent(repoId)}/merge_requests`,
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
            url: `/api/v4/projects/${encodeURIComponent(repoId)}/merge_requests`,
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
