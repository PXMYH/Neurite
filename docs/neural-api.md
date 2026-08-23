# Neural API

Call Neurite's own functions — and sequence animations of them — from a terminal inside Neurite.

[← Back to the Neurite README](../README.md)

<table>
  <tr>
    <!-- Left: Image -->
    <td valign="top" width="40%">
      <p align="center">
        <img src="https://github.com/satellitecomponent/Neurite/assets/129367899/d45fe622-6dab-4e43-91c7-06e0d7cddaed" alt="neuralapi" width="100%">
      </p>
    </td>
    <!-- Right: Description of the Function Calling Panel -->
    <td valign="top" width="60%">
      <h3>Experimental Update: Function Calling Panel</h3>
      <p>This feature is a terminal that allows you to execute Neurite's code from within Neurite itself.</p>
      <p>Included with the function calling panel update is our Neural API. The Neural API is a growing collection of existing features within Neurite, made for sequencing animations of function calls. The current features include:</p>
      <ul>
        <li>Animate movements through the Mandelbrot set</li>
        <li>Determine exact coordinates to zoom to</li>
        <li>Call GPT 4 Vision to determine the next movement (set number of iterations)</li>
        <li>Create notes</li>
        <li>Prompt the Zettelkasten Ai</li>
        <li>Prompt the user</li>
        <li>Search and Zoom to Notes</li>
      </ul>
      <p>You can call on GPT to construct the sequences of function calls itself. It has access to the documentation.</p>
      <p>For the current documentation, try calling the below from within the function panel:</p>
      <pre><code>const neuralAPI = neuralApiPrompt();
console.log(neuralAPI);</code></pre>
      <p>The current Neural API documentation will display in your call history for the function calling panel as well as in your browser console.</p>
      <p>There will be more information on this soon. This is a new feature in the initial release.</p>
    </td>
  </tr>
</table>
