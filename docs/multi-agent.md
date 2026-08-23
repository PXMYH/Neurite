# Multi-Agent UI

Connected AI Nodes talking to each other, the Providers they can run on, and the AI plugins.

[← Back to the Neurite README](../README.md)

<table>
  <tr>
    <!-- Left: Text Description -->
    <td valign="top" width="50%">
      <h3>🤖 Build Multi-Agent Chat Networks 🤖💬🗨️🤖🗨️🤖</h3>
      <ul>
        <li>Connected AI nodes send messages to one another. This idea contains endless possibilities. (<em>Hold Shift + Click</em> two node windows to connect. <em>Click</em> connections to change their direction. <em>Shift + Double Click</em> to delete.)</li>
        <li>Supports Local and Cloud-based models concurrently.</li>
      </ul>
      <h3><a href="https://en.wikipedia.org/wiki/Flow-based_programming">flow-based</a> Ai-Agents ⛓️💭</h3>
      <p>🔄 <strong>Message Looping:</strong> Initiate conversational threads across connected AI nodes.</p>
      <ul>
        <li><strong>Prompt Generation:</strong>Connected nodes send messages to one another. They can begin messages with @ for references to other Ai or @self, and / for a growing range of commands such as /exit to exit a loop.</li>
        <li><strong>Ai Logic Circuits:</strong>
          <ul>
            <li><strong>Determine Conversation Hierarchy:</strong> Take control of Ai conversation flows via Neurite's modular user interface. Adjust the direction of conversation across connected AI nodes between two-way, or sending/receiving.</li>
          </ul>
        </li>
        <li><strong>Graph Context:</strong>
          <ul>
            <li><strong>Networked Instructions:</strong> Ai nodes read all connected graphs.</li>
            <li><strong>Shared Instructions:</strong> Compare Various AI models from the same set of prompts.</li>
          </ul>
        </li>
        <li><strong>Connect Data:</strong>
          <ul>
            <li><strong>Read Connected Web-Link Nodes:</strong> Connect webpages and Ai nodes to utilize RAG search for that document. Create specialized autonomous agent swarms via mind mapping.</li>
          </ul>
        </li>
        <li><strong>Related Research:</strong> <a href="https://arxiv.org/abs/2309.03220">Conversational Swarm Intelligence Paper</a></li>
      </ul>
    </td>
    <!-- Right: Image -->
    <td valign="top" width="50%">
      <p align="center">
        <img src="https://github.com/satellitecomponent/Neurite/assets/129367899/bada5e60-73de-41de-8a64-10e7451393b0" alt="Multi-Agent Chat Networks" width="100%">
                <img src="https://github.com/satellitecomponent/Neurite/assets/129367899/2f6f16be-659c-4048-aa8e-3aa7bcc73f35" alt="Multi-Agent Chat Networks3" width="100%">
        <img src="https://github.com/satellitecomponent/Neurite/assets/129367899/baf78511-3d07-41d0-afc8-93ad80b693ab" alt="Multi-Agent Chat Networks2" width="100%">
      </p>
    </td>
  </tr>
</table>

### `Unbounded AI Collaboration`

### An open-world generative landscape for thought integrated with artificial intelligence.

<h3 align="center">AI Inference Providers</h3>

<table align="center">
<thead>
<tr>
<th align="center">Local</th>
<th align="center">Cloud</th>
</tr>
</thead>
<tbody>
<tr>
<td align="center"><a href="https://github.com/ollama/ollama">Ollama</a></td>
<td align="center"><a href="https://openai.com/">OpenAI</a></td>
</tr>
<tr>
<td align="center"><a href="https://huggingface.co/docs/transformers.js/en/index">transformers.js</a></td>
<td align="center"><a href="https://groq.com/">Groq</a></td>
</tr>
<tr>
<td align="center"><a href="https://github.com/ggerganov/llama.cpp">Custom</a></td>
<td align="center"><a href="https://docs.anthropic.com/en/docs/quickstart-guide">Anthropic</a></td>
</tr>
</tbody>
</table>

### Neurite Supports the following AI Plugins: ⚡
<table>
  <tr>
    <th>Plugin</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><strong>Auto Mode</strong></td>
    <td>Enable the AI to recursively generate its own prompts.</td>
  </tr>
  <tr>
    <td><strong>Long-Term Memory</strong></td>
    <td>Utilize nodal recall through our vector-embedded search of your notes and conversation. Includes experimental ability to forget certain memories.</td>
  </tr>
  <tr>
    <td><strong>Experimental Code Editor</strong></td>
    <td>
      <ul>
        <li><strong>HTML/JS:</strong> Render GPT's code output directly. Connected nodes bundle any HTML/CSS/JS code blocks or editors.</li>
        <li><strong>Python (<a href="https://github.com/pyodide/pyodide">Pyodide</a>):</strong> Execute Python code directly within the browser.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td><strong>Web Search</strong></td>
    <td>Search the web from directly within Neurite. Ai-assisted search automation.</td>
  </tr>
  <tr>
    <td><strong>Understands Webpages and PDFs</strong></td>
    <td>Leverage a local vector database that allows Ai to retrieve context from webpages and PDFs.</td>
  </tr>
  <tr>
    <td><strong>Wikipedia Results</strong></td>
    <td>Retrieve the top 3 Wikipedia results or shuffle through the top 20. (novelty mode)</td>
  </tr>
  <tr>
    <td><strong>Wolfram Alpha Results</strong></td>
    <td>Local Wolfram Plugin where Ai thinks ahead of the query. Provide Wolfram results to Ai and display them as nodes.</td>
  </tr>
</table>

All API keys can be input through the AI tab in the menu dropdown.
