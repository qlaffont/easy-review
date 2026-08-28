# In-app auto-merge

GitHub’s auto-merge mutation is refused unless the repository has **Allow auto-merge** on. Easy Review queues the merge locally and calls the normal merge API when the pull request is ready, so auto-merge works without that setting. The queue only runs while Easy Review is open in the browser.
