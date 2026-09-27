Prompt.autoMode = function(begin, end){
    return `Self-Prompting is ENABLED. On the last line, WRAP a message to yourself with ${begin} to begin and ${end} to end the prompt. Progress the conversation yourself.`
}
Prompt.googleSearch = function(content){
    return `Google Search RESULTS displayed to the user:<searchresults>${content}</searchresults> CITE your sources! Always REMEMBER to follow the <format> message`
}
Prompt.history = function(context){
    return `CONVERSATION HISTORY: <context>${context}</context>`
}
Prompt.markdownIdentity = function(aiId){
    return "You are " + aiId + ". Conversation renders via markdown."
}
Prompt.matchedNodes = function(content){
    return `Semantically RELEVANT NOTES retrieved. BRANCH UNIQUE notes OFF OF the following ALREADY EXISTING nodes.:\n<topmatchednodes>${content}</topmatchednodes>SYNTHESIZE missing, novel, and connected KNOWLEDGE from the given topmatchednodes.`
}
Prompt.searchQuery = async function(message, searchQuery, filteredKeys, topN, recentContext, node, allConnectedNodesData){
    if (!searchQuery || !filteredKeys) return;

    const relevantKeys = await (
        (!node)
          ? Keys.getRelevant(message, recentContext, searchQuery, filteredKeys)
          : Keys.getRelevantNodeLinks(
               allConnectedNodesData,
               message,
               searchQuery,
               filteredKeys,
               recentContext
            )
      );
    if (relevantKeys.length < 1) return;

    const relevantChunks = await getRelevantChunks(searchQuery, topN, relevantKeys);
    if (node) node.currentTopNChunks = relevantChunks;
    const topNChunks = groupAndSortChunks(relevantChunks, MAX_CHUNK_SIZE);
    return `Top ${topN} MATCHED snippets of TEXT from extracted WEBPAGES:\n <topNchunks>${topNChunks}</topNchunks>\n> Provide EXACT INFORMATION from the given snippets! Use [Snippet n](source) to display references to exact snippets. Make exclusive use of the provided snippets.`
}
Prompt.wikipedia = function(keywords, summaries){
    return `Wikipedia Summaries (Keywords: ${keywords}): \n ${summaries} END OF SUMMARIES`
}
Prompt.wolfram = function(data){
    createWolframNode(data);
    const textResult = data.wolframAlphaTextResult;
    Logger.info("wolframAlphaTextResult:", textResult);
    return "The Wolfram result has ALREADY been returned based off the current user message. INSTEAD of generating a new query, USE the following Wolfram result as CONTEXT: " + textResult;
}

async function sendMessage(event, autoModeMessage) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    // One send at a time, as an AI Node has. Pressed again while one ran -- Enter in the
    // prompt -- the first send's end took the prompt to rest while the second still ran,
    // so a click then deleted the first exchange; in auto mode it forked a second loop.
    // The text stays in the box for when this one is done.
    if (!autoModeMessage && Ai.send) return;

    const activeInstance = getActiveZetCMInstanceInfo();

    const promptElement = Elem.byId('prompt');
    const promptValue = promptElement.value;
    promptElement.value = ''; // Clear the textarea
    const promptEvent = new Event('input', {
        'bubbles': true,
        'cancelable': true
    });
    promptElement.dispatchEvent(promptEvent);

    const message = Ai.latestUserMessage = autoModeMessage || promptValue;

    Ai.isAutoModeEnabled = Elem.byId('auto-mode-checkbox').checked;
    if (Ai.isAutoModeEnabled && Ai.originalUserMessage === null) {
        Ai.originalUserMessage = message;
    }

    // This send's identity. A stop drops it (`Ai.haltZettelkasten`), and a send that is no
    // longer `Ai.send` has been stopped: it asks for nothing more, and leaves the state to
    // whoever holds it now. A shared flag could not tell a stopped send from the one sent
    // after it: stopped during a helper that cannot be aborted and sent again, the first
    // resumed when the helper settled, and both questions were answered.
    const send = Ai.send = {asked: Boolean(autoModeMessage)};   // a self-prompt has no question to give back

    // The send is under way from here, helpers and all, so the prompt's button stops it.
    // Until the answer's own call began it read "not responding", and a click while the
    // keywords or the note search ran regenerated instead: `removeLastResponse` deleted
    // the last exchange from the notes. The AI Node's send does the same at its start.
    // The loading icon too: the keywords are a round trip before the answer's call shows it.
    let answer, again = false;
    try {
        // Inside the `try`: once `Ai.send` is set, nothing may leave it set, or every send
        // after would be refused as one already running.
        Ai.isResponding = true;
        Ai.shouldContinue = true;
        Ai.mainPrompt.setPause();
        Elem.byId('aiLoadingIcon').style.display = 'block';

        answer = await askWithContext(message, autoModeMessage, activeInstance, send);
    } catch (err) {
        // A helper that threw ends the send like any failure: said on screen, and the
        // question given back if it was never written into the notes.
        Logger.err("While sending:", err);
        Elem.byId('aiErrorIcon').style.display = 'block';
        const box = Elem.byId('prompt');
        if (Ai.send === send && !send.asked && !box.value) box.value = message;
    } finally {
        // Whatever ended the send -- its answer, no key, Neurite signed out, a helper that
        // threw -- it ends here, and the start above is undone; a stop has undone it
        // already. Only the answer's own call used to, so a send that never reached one
        // stayed "responding", and auto mode went round again on nothing: measured, 25
        // passes and 49 sign-in dialogs in 3 s with Neurite signed out. It goes round
        // again only on an answer with words in it -- one of only whitespace went round
        // 1,172 times in 3 s -- and only while the box is still ticked.
        if (Ai.send === send) {
            Ai.send = null;
            again = Boolean(answer?.trim()) && Elem.byId('auto-mode-checkbox').checked;
            Elem.hideById('aiLoadingIcon');
            if (!again) {
                Ai.isResponding = false;
                Ai.mainPrompt.setRefresh();
            }
        }
    }

    if (again) sendMessage(null, extractLastPrompt());
}

// Everything between a send's start and its answer: the helpers that gather the context,
// then the answer's own call. Answers what that call returned, or nothing when the send was
// stopped before it -- and each helper is a request, so the stop is read after every one.
async function askWithContext(message, autoModeMessage, activeInstance, send){
    const noteInput = activeInstance.textarea;
    const cm = activeInstance.cm;
    const stopped = ()=>(Ai.send !== send);

    // Check if the last character in the note-input is not a newline, and add one if needed
    if (noteInput.value.length > 0 && noteInput.value[noteInput.value.length - 1] !== '\n') {
        cm.replaceRange('\n', CodeMirror.Pos(cm.lastLine()));
    }

    const arrKeywords = await generateKeywords(message, 3); // number of desired keywords
    if (stopped()) return;
    // Comma-separated: `Embeddings.search` splits on commas, so a space-joined list was
    // one phrase no note contains -- with embeddings down, no note was ever relevant.
    const strKeywords = arrKeywords.join(', ');

    let wikipediaPrompt;
    if (Wikipedia.isEnabled()) {
        const summaries = await Wikipedia.getSummaries([arrKeywords[0]]);
        if (stopped()) return;
        wikipediaPrompt = Prompt.wikipedia(strKeywords, summaries);
    }

    let searchQuery = null;
    let filteredKeys = null;

    if (isGoogleSearchEnabled() || (filteredKeys = await isEmbedEnabled())) {
        try {
            searchQuery = await constructSearchQuery(message);
        } catch (err) {
            Logger.err("In constructing search query:", err);
        }
    }
    if (stopped()) return;

    let googleSearchPrompt;
    if (isGoogleSearchEnabled()) {
        const content = handleNaturalLanguageSearch(searchQuery, message);
        googleSearchPrompt = Prompt.googleSearch(content);
    }

    const aiCall = AiCall.stream().addSystemPrompt(Prompt.mindmap());
    if (Elem.byId('instructions-checkbox').checked) {
        aiCall.addSystemPrompt(Prompt.instructions())
    }
    if (Elem.byId('code-checkbox').checked) {
        aiCall.addSystemPrompt(Prompt.code())
    }
    if (wikipediaPrompt) aiCall.addSystemPrompt(wikipediaPrompt);
    if (googleSearchPrompt) aiCall.addSystemPrompt(googleSearchPrompt);
    if (Elem.byId('ai-nodes-checkbox').checked) {
        aiCall.addSystemPrompt(Prompt.aiNodes())
    }

    const searchQueryPrompt = await Prompt.searchQuery(message, searchQuery, filteredKeys, topN);
    if (stopped()) return;
    if (searchQueryPrompt) aiCall.addSystemPrompt(searchQueryPrompt);

    // calculate remaining tokens
    const maxTokens = Elem.byId('max-tokens-slider').value;
    const remainingTokens = Math.max(0, maxTokens - TokenCounter.forMessages(aiCall.messages));
    const maxContextSize = Elem.byId('max-context-size-slider').value;
    const contextSize = Math.min(remainingTokens, maxContextSize);

    let context = getLastPromptsAndResponses(100, contextSize);

    const existingTitles = extractTitlesFromContent(context);
    Logger.debug(`existingTitles`, existingTitles, context);

    const topMatchedNodes = await Graph.searchNotes(strKeywords);
    if (stopped()) return;
    const nodeContents = filterAndProcessNodesByExistingTitles(topMatchedNodes, existingTitles);
    Logger.debug(nodeContents);

    let topMatchedNodesContent = nodeContents.join("\n\n");

    // If forgetting is enabled, extract titles to forget
    if (Elem.byId('forget-checkbox').checked) {
        const titlesToForget = await forget(message, `${context}\n\n${topMatchedNodesContent}`);
        if (stopped()) return;
        Logger.info("Titles to Forget:", titlesToForget);

        context = removeTitlesFromContext(context, titlesToForget);

        topMatchedNodesContent = filterAndProcessNodesByExistingTitles(topMatchedNodes, existingTitles, titlesToForget).join("\n\n");
        Logger.debug("Refiltered Top Matched Nodes Content:", topMatchedNodesContent);
    }

    if (topMatchedNodesContent.trim() !== '' && !Elem.byId('instructions-checkbox').checked) {
        const prompt = Prompt.matchedNodes(topMatchedNodesContent);
        aiCall.messages.splice(1, 0, Message.system(prompt));
    }

    if (context.trim() !== '') {
        aiCall.messages.splice(2, 0, Message.system(Prompt.history(context)))
    }

    const autoModePrompt = (!Ai.isAutoModeEnabled) ? ''
                         : Prompt.autoMode(PROMPT_IDENTIFIER, PROMPT_END);

    const prompt = (!autoModeMessage) ? `${message}\n${autoModePrompt}`.trim()
                 : `Your current self-${PROMPT_IDENTIFIER} ${autoModeMessage} ${PROMPT_END}
    Original ${PROMPT_IDENTIFIER} ${Ai.originalUserMessage} ${PROMPT_END}
    ${autoModePrompt}`;
    aiCall.addUserPrompt(prompt);

    const lineBeforeAppend = cm.lastLine();

    if (!autoModeMessage) {
        handleUserPromptAppendCodeMirror(cm, message, PROMPT_IDENTIFIER);
    } else if (autoModeMessage) {
        cm.replaceRange(`\n`, CodeMirror.Pos(lineBeforeAppend));
    }
    send.asked = true;

    activeInstance.ui.scrollToLine(cm, lineBeforeAppend + 2); // Scroll to the new last line
    userScrolledUp = false;

    // Handle Wolfram Loop after appending the prompt.

    const wolframData = (!Elem.byId('enable-wolfram-alpha').checked) ? ''
                      : await fetchWolfram(message, false, null, "", stopped);
    if (stopped()) return;
    if (wolframData) aiCall.addSystemPrompt(Prompt.wolfram(wolframData));

    return aiCall.exec();
}
