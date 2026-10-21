chrome.storage.sync.get("color").then((r) => { document.getElementById("color").textContent = `colour: ${r.color}` })
