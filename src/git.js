const gitUtils = require('./git-utils');
const gitApi = require('simple-git');
const assert = require('assert');

module.exports = workspaceFolderPath => {
    const gitContext = gitApi(workspaceFolderPath);

    const checkStatus = async originBranch => {
        const status = await gitContext.status();

        const currentBranch = status.current;
        const onMaster = currentBranch === originBranch;
        const isConflicted = status.conflicted.length > 0;
        const cleanBranch = status.created.length === 0 &&
                            status.deleted.length === 0 &&
                            status.modified.length === 0 &&
                            status.not_added.length === 0 &&
                            status.renamed.length === 0;

        assert(!isConflicted, 'Unresolved conflicts, please resolve before opening MR.');

        return {
            onMaster,
            cleanBranch
        };
    };

    const getCurrentBranch = async () => {
        const status = await gitContext.status();

        return status.current;
    };

    const lastCommitMessage = async () => {
        const log = await gitContext.log();

        const message = log.latest ? log.latest.message : '';

        // Commit messages are suffixed with message starting with '(HEAD -> )'
        return message.split('(HEAD')[0].trim();
    };

    const parseRemotes = async targetRemote => {
        const remotes = await gitContext.getRemotes(true);

        assert(remotes && remotes.length, 'No remotes configured.');

        // Determine which Gitlab server this repo uses
        const remote = remotes.find(remote => remote.name === targetRemote);

        assert(remote, `Target remote ${targetRemote} does not exist.`);

        // Parse repo host and tokens
        const repoUrl = remote.refs.push;

        const parsedRemote = gitUtils.parseRepoUrl(repoUrl);

        return parsedRemote;
    };

    const createBranch = branchName => gitContext.checkout(['-b', branchName]);

    const checkoutBranch = args => gitContext.checkout(args);

    const addFiles = files => gitContext.add(files);

    const commitFiles = commitMessage => gitContext.commit(commitMessage);

    const pushBranch = (targetRemote, branchName) => gitContext.push(['-u', targetRemote, branchName]);

    const fetchRemote = (targetRemote, branchName) => gitContext.fetch(targetRemote, branchName);

    const listBranches = () => gitContext.branch();

    return {
        checkStatus,
        lastCommitMessage,
        parseRemotes,
        createBranch,
        checkoutBranch,
        listBranches,
        fetchRemote,
        addFiles,
        commitFiles,
        pushBranch,
        getCurrentBranch
    };
};
