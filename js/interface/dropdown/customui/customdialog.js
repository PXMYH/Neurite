// `title` names the dialog after what it asks for; it read "Prompt" whatever it asked.
window.prompt = async (message, defaultValue = '', title = null) => {
    Modal.open('promptModal'); // Load content into modal body
    if (title) Modal.div.querySelector('.modal-title').textContent = title;

    const modalBody = Modal.div.querySelector('.modal-body');
    if (!modalBody) {
        Logger.err("Modal body not found!");
        return null;
    }

    const messageEl = modalBody.querySelector('.modal-prompt-message');
    const inputEl = modalBody.querySelector('.modal-prompt-textarea'); // This is now a textarea
    const okBtn = modalBody.querySelector('.modal-ok');
    const cancelBtn = modalBody.querySelector('.modal-cancel');

    if (!messageEl || !inputEl || !okBtn || !cancelBtn) {
        Logger.err("Missing elements in prompt modal!");
        return null;
    }

    messageEl.textContent = message;
    // The box is named by the question it answers: it had no name at all.
    inputEl.setAttribute('aria-label', message);
    inputEl.value = defaultValue;
    inputEl.focus(); // Auto-focus textarea
    // The answer offered is selected, so typing replaces it, as a native prompt's does: with
    // the caret at its end, a rename to "Learning" gave "Archive 2Learning".
    inputEl.select();

    return new Promise((resolve) => {
        const handleOk = () => {
            resolve(inputEl.value);
            Modal.close();
            cleanup();
        };

        const handleCancel = () => {
            resolve(null);
            Modal.close();
            cleanup();
        };
        Modal.unanswered = ()=>{
            resolve(null);
            cleanup();
        };

        const handleKey = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // If Enter is pressed without Shift, submit the input
                e.preventDefault(); // Prevent new line in textarea
                handleOk();
            } else if (e.key === 'Escape') {
                // Only the dialog: the menu's own Escape, reached next, took the panel the
                // dialog was opened from back to the list.
                e.stopPropagation();
                handleCancel();
            }
            // If Shift+Enter is pressed, allow new lines (default behavior)
        };

        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            cancelBtn.removeEventListener('click', handleCancel);
            inputEl.removeEventListener('keydown', handleKey);
        };

        okBtn.addEventListener('click', handleOk);
        cancelBtn.addEventListener('click', handleCancel);
        inputEl.addEventListener('keydown', handleKey);
    });
}
window.alert = async (message) => {
    Modal.open('alertModal');
    const modalBody = Modal.div.querySelector('.modal-body');
    const messageEl = modalBody.querySelector('.alert-message');
    const okBtn = modalBody.querySelector('.modal-ok');
    messageEl.textContent = message;
    Modal.describeBy(messageEl);

    return new Promise((resolve) => {
        okBtn.addEventListener('click', () => {
            resolve();
            Modal.close();
        }, { once: true });
        Modal.unanswered = resolve;
        okBtn.focus({preventScroll: true});
    });
}
// A caller that can say more names the dialog after its question (`title`) and its OK after
// what it does (`ok`), and marks an answer that destroys something (`danger`); the message is
// then what the answer does, and may be empty. Without them it is a native confirm: the
// message under "Confirm", answered OK or Cancel.
window.confirm = async (message, options) => {
    const {title, ok, danger} = options ?? {};
    Modal.open('confirmModal');
    if (title) Modal.div.querySelector('.modal-title').textContent = title;
    const modalBody = Modal.div.querySelector('.modal-body');
    const messageEl = modalBody.querySelector('.confirm-message');
    const okBtn = modalBody.querySelector('.modal-ok');
    const cancelBtn = modalBody.querySelector('.modal-cancel');
    messageEl.textContent = message;
    if (message) Modal.describeBy(messageEl);
    if (ok) okBtn.textContent = ok;
    okBtn.classList.toggle('danger', Boolean(danger));

    return new Promise((resolve) => {
        const cleanup = (result) => {
            resolve(result);
            Modal.close();
        };
        Modal.unanswered = ()=>resolve(false);
        okBtn.addEventListener('click', () => cleanup(true), { once: true });
        cancelBtn.addEventListener('click', () => cleanup(false), { once: true });
        // The keyboard starts on the answer that changes nothing: the dialog opened with focus
        // on the page behind it, where Enter did nothing and no Tab led into the dialog. Not
        // scrolled to: a question too long for a short window is read from its top.
        cancelBtn.focus({preventScroll: true});
    });
}

// The message is what an alert or a confirm says, so it describes the dialog: read out with
// its title when it opens. The copy in the body gets the id, not the template it came from.
Modal.describeBy = function (messageEl) {
    messageEl.id = 'modal-message';
    Modal.div.setAttribute('aria-describedby', messageEl.id);
}
