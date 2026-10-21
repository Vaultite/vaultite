document.getElementById("stopped").textContent = `stopped ${new URLSearchParams(location.search).get("from")} (${chrome.runtime.id})`
