const wolframMessage = `Based off the user message, arrive at a valid query to Wolfram Alpha.
- Quotation marks delimit the Wolfram Query that is extracted from your response.
- Ensure the query will return a relevant result from Wolfram. (If the user message is not a valid Wolfram Query, reformulate until it is.)
- Utilize Wolfram Syntax or formats known to be valid.
- Display your reasoning.`

let wolframCallCounter = 0;

const wolframUnreachable = "Wolfram Alpha could not be reached. Ensure the Wolfram server is running on your localhost with a valid Wolfram API key. The API input is in the Ai panel. Localhosts can be found at the Github link in the Help panel.";

async function fetchWolfram(message, isAINode = false, node = null, wolframContext = "") {
    // Only the localhost gateway answers Wolfram. Without it, the reformulation below is
    // an AI round trip for a query nobody can send -- paid on every send, and on every
    // pass of auto mode, before the fetch failed anyway. `useProxy` is the gateway as it
    // was at boot, so it is asked once more before the answer is no: a gateway started
    // after the page was refused for the rest of the session.
    if (!useProxy && !(await Request.send(new Host.checkServer.ct()))) {
        alert(wolframUnreachable);
        return;
    }

    let wolframAlphaResult = "not-enabled";
    let wolframAlphaTextResult = "";

    // Initialize recentcontext based on node or default zettelkasten logic
    const recentcontext = wolframContext || getLastPromptsAndResponses(2, 300);

    if (!isAINode) {
        // Increment the Wolfram call counter
        wolframCallCounter++;

        // Insert the tag and unique title to the note-input
        window.currentActiveZettelkastenMirror.replaceRange(`${tagValues.nodeTag} Wolfram ${wolframCallCounter}\n`, CodeMirror.Pos(window.currentActiveZettelkastenMirror.lastLine()));
    }

    const aiCall = AiCall.stream(isAINode && node)
        .addSystemPrompt(wolframMessage)
        .addUserPrompt(message + " Wolfram Query");

    // Only add the recentcontext message if it is not empty
    if (recentcontext.trim() !== "") {
        const prompt = `Conversation history; \n ${recentcontext},`;
        aiCall.messages.splice(1, 0, Message.system(prompt));
    }

    const fullResponse = await aiCall.exec();
    if (isAINode && node) {
        // Add a line break to node.aiResponseDiv after the call is complete
        node.aiResponseDiv.innerHTML += '<br />';
    }

    // The regular expression to match text between quotation marks
    const regex = /"([^"]*)"/g;

    let reformulatedQuery = "";
    let matches = [];
    let match;

    // While loop to get all matches
    while ((match = regex.exec(fullResponse)) !== null) {
        matches.push(match[1]);
    }

    // Get the last match, i.e., the reformulated query
    if (matches.length > 0) {
        reformulatedQuery = matches[matches.length - 1];
    }
    Logger.info("reformulated query", reformulatedQuery);
    Logger.info("matches", matches);
    let preface = fullResponse.replace(`"${reformulatedQuery}"`, "").trim();

    // Append an additional new line
    window.currentActiveZettelkastenMirror.replaceRange(`\n\n`, CodeMirror.Pos(window.currentActiveZettelkastenMirror.lastLine()));

    Logger.info("Preface:", preface);
    Logger.info("Reformulated query:", reformulatedQuery);

    // Call Wolfram Alpha API with the reformulated query
    const apiKey = Elem.byId('wolframApiKey').value;

    // A gateway that is not running rejects the fetch outright, which is a different
    // failure from a gateway answering with an error below -- and the bare `await` let it
    // propagate and abort the AI send, after the reformulation round trip had already been
    // paid for (#10). Both now end the same way: say what to check, and send without it.
    let response;
    try {
        response = await fetch(Host.urlForPath('/wolframalpha'), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query: reformulatedQuery,
                apiKey: apiKey
            }),
        });
    } catch (err) {
        Logger.err("Wolfram Alpha request failed:", err);
        alert(wolframUnreachable);
        return;
    }

    // Either body can be something other than JSON -- a gateway without the Wolfram
    // route answers with an HTML 404 -- and a throw here aborted the AI send.
    if (!response.ok) {
        const errorData = await response.json().catch( ()=>({}) );
        Logger.err("With Wolfram Alpha API call:", errorData.error);
        Logger.err("Full error object:", errorData);
        alert("An error occurred when making a request the Wolfram Alpha. Ensure the Wolfram server is running on your localhost with a valid Wolfram API key. The API input is in the Ai panel. Localhosts can be found at the Github link in the Help panel.");
        return;
    }

    const data = await response.json().catch( ()=>null );
    Logger.info("Wolfram Alpha data:", data); // Debugging data object
    if (!data?.pods) return;

    const table = Html.new.table();
    table.style = "width: 100%; border-collapse: collapse;";

    for (const pod of data.pods) {
        const row = Html.new.tr();

        const titleCell = Html.new.td();
        titleCell.textContent = pod.title;
        titleCell.style = "padding: 10px; background-color: #222226;";

        const imageCell = Html.new.td();
        imageCell.style = "padding: 10px; text-align: center; background-color: white";

        for (let i = 0; i < pod.images.length; i++) {
            const imageUrl = pod.images[i];
            const plaintext = pod.plaintexts[i];

            // Adding plaintext to wolframAlphaTextResult
            wolframAlphaTextResult += `${pod.title}: ${plaintext}\n`;

            const img = Html.new.img();
            img.alt = `${reformulatedQuery} - ${pod.title}`;
            img.style = "display: block; margin: auto; border: none;";
            img.src = imageUrl;

            imageCell.appendChild(img);
        }

        row.appendChild(titleCell);
        row.appendChild(imageCell);
        table.appendChild(row);
    }

    return { table, wolframAlphaTextResult, reformulatedQuery };
}
