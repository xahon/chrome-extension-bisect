(async function () {
    const printDebugInfo = false;
    const reloadPageCheckbox = document.querySelector("#reload_checkbox");
    const debugBar = document.querySelector("#debug_bar");
    const statusBar = document.querySelector("#status_bar");
    const startBtn = document.querySelector("#start_btn");
    const goodBtn = document.querySelector("#good_btn");
    const badBtn = document.querySelector("#bad_btn");
    const resetBtn = document.querySelector("#reset_btn");
    const extensionList = document.querySelector("#extension_list");

    const storageData = {
        bisectIsInProgress: false,
        reloadPageEachTime: false,
        brokenExtIndex: -1,
        leftIndex: 0,
        rightIndex: 0,
        inspectingLeftIndex: 0,
        inspectingRightIndex: 0,
        mid: 0,
        initialExtensions: []
    };

    reloadPageCheckbox.addEventListener("change", async () => {
        storageData.reloadPageEachTime = reloadPageCheckbox.checked;
    });
    startBtn.addEventListener("click", start_bisect);
    goodBtn.addEventListener("click", good_bisect);
    badBtn.addEventListener("click", bad_bisect);
    resetBtn.addEventListener("click", reset);

    Object.assign(storageData, await chrome.storage.local.get());
    reloadPageCheckbox.checked = storageData.reloadPageEachTime;

    const self = await chrome.management.getSelf();

    if (storageData.brokenExtIndex !== -1) {
        await update_gui();
        await finish();
    } else {
        await update_gui();
    }

    async function update_gui() {
        if (storageData.bisectIsInProgress) {
            const stepsLeft = get_steps_left(storageData.leftIndex, storageData.rightIndex);
            statusBar.innerHTML = `Bisect in progress.<br>Roughly ${stepsLeft} steps left. Press 'Good' or 'Bad' depending on whether the issue is still present or not.<br>Continue these steps until bisection is ended or 'Reset' to the initial state any time. All disabled extension will be re-enabled again.`;
            startBtn.disabled = true;
            goodBtn.disabled = false;
            badBtn.disabled = false;

            await force_recreate_extensions_list()
        } else {
            if (storageData.brokenExtIndex !== -1) {
                startBtn.disabled = true;
                goodBtn.disabled = true;
                badBtn.disabled = true;

                const brokenFound = storageData.brokenExtIndex !== -1;
                const brokenExt = brokenFound ? storageData.initialExtensions[storageData.brokenExtIndex] : null;
                statusBar.innerHTML = `Broken extension is <b>${brokenExt.name}</b> (${brokenExt.id})<br><a href=\"${brokenExt.homepageUrl}\" target="_blank">Go to extension homepage</a><br>Please report the issue to the extension author`;
                await force_recreate_extensions_list();
                return;
            }
            statusBar.innerHTML = `Bisect is not yet started. Start it with the 'Start' button`;
            startBtn.disabled = false;
            goodBtn.disabled = true;
            badBtn.disabled = true;

            remove_extensions_list();
        }

        if (printDebugInfo) {
            debugBar.textContent = JSON.stringify((() => {
                let tmp = {};
                Object.assign(tmp, storageData);
                delete tmp.initialExtensions;
                tmp["extensionsCount"] = storageData.initialExtensions.length;
                return tmp;
            })(), null, 4);
        }
    }

    async function force_recreate_extensions_list() {
        extensionList.innerHTML = "";

        for (let i = 0; i < storageData.initialExtensions.length; i++) {
            let isEnabled = false;
            if (i >= storageData.mid && i < storageData.rightIndex) {
                isEnabled = true;
            }

            const debugStateCheckExt = await chrome.management.get(storageData.initialExtensions[i].id);
            if (debugStateCheckExt.enabled !== isEnabled) {
                console.log(`Extension ${storageData.initialExtensions[i].name} (${storageData.initialExtensions[i].id}) is not in the correct state. Should be '${isEnabled}' but is '${debugStateCheckExt.enabled}'`);
            }

            let color = "transparent";
            if (i === storageData.brokenExtIndex || i >= storageData.leftIndex && i < storageData.mid) {
                color = "lightcoral";
            } else if (i >= storageData.mid && i < storageData.rightIndex) {
                color = "lightgreen";
            }

            const liElement = create_li(storageData.initialExtensions[i].name, isEnabled, color);
            extensionList.appendChild(liElement);
        }
    }

    function remove_extensions_list() {
        extensionList.innerHTML = "";
    }

    function create_li(name, isEnabled, color = "transparent") {
        let liElement = document.createElement("li");
        let liNameElement = document.createElement("span");
        let liCheckBoxElement = document.createElement("input");

        liNameElement.textContent = name;

        liCheckBoxElement.type = "checkbox";
        liCheckBoxElement.checked = isEnabled;
        liCheckBoxElement.disabled = true;

        liElement.appendChild(liNameElement);
        liElement.appendChild(liCheckBoxElement);

        liElement.style.backgroundColor = color;

        return liElement;
    }

    async function start_bisect() {
        let allExtensions = await chrome.management.getAll();

        storageData.bisectIsInProgress = true;
        storageData.initialExtensions = allExtensions.filter((ext) => ext.enabled && ext.mayDisable && ext.id !== self.id);
        storageData.leftIndex = 0;
        storageData.rightIndex = storageData.initialExtensions.length;
        storageData.mid = get_mid(storageData.leftIndex, storageData.initialExtensions.length);
        await chrome.storage.local.set(storageData);

        if (storageData.rightIndex - storageData.leftIndex === 1) {
            storageData.brokenExtIndex = storageData.leftIndex;
            await chrome.storage.local.set(storageData);
            await finish();
            return
        }

        await update_enabled_extension_range();
        await update_gui();
    }

    function get_steps_left(leftIndex, rightIndex) {
        return Math.floor(Math.log2(rightIndex - leftIndex));
    }

    function get_mid(leftIndex, rightIndex) {
        return Math.floor((leftIndex + rightIndex) / 2);
    }

    async function update_enabled_extension_range() {
        for (let i = 0; i < storageData.initialExtensions.length; i++) {
            await chrome.management.setEnabled(storageData.initialExtensions[i].id, i >= storageData.mid && i < storageData.rightIndex);
        }

        if (storageData.reloadPageEachTime) {
            const tabs = await chrome.tabs.query({active: true, currentWindow: true});
            await chrome.tabs.reload(tabs[0].id);
        }
    }

    async function good_bisect() {
        const mid = get_mid(storageData.leftIndex, storageData.mid);
        storageData.rightIndex = storageData.mid;
        storageData.mid = mid;
        await chrome.storage.local.set(storageData);

        await update_enabled_extension_range();

        if (storageData.rightIndex - storageData.leftIndex === 1) {
            storageData.brokenExtIndex = storageData.leftIndex;
            await chrome.storage.local.set(storageData);
            await finish();
            return;
        }

        await update_gui();
    }

    async function bad_bisect() {
        storageData.leftIndex = storageData.mid;
        storageData.mid = get_mid(storageData.leftIndex, storageData.rightIndex);
        await chrome.storage.local.set(storageData);

        await update_enabled_extension_range();

        if (storageData.rightIndex - storageData.leftIndex === 1) {
            storageData.brokenExtIndex = storageData.leftIndex;
            await chrome.storage.local.set(storageData);
            await finish();
            return;
        }

        await update_gui();
    }

    async function finish() {
        if (storageData.brokenExtIndex === -1) {
            await reset();
            return;
        }

        storageData.bisectIsInProgress = false;

        await resetExts();
        await update_gui();
    }

    async function resetExts()
    {
        for (let i = 0; i < storageData.initialExtensions.length; i++) {
            await chrome.management.setEnabled(storageData.initialExtensions[i].id, true);
        }
    }

    async function reset() {
        await resetExts();

        if (storageData.brokenExtIndex !== -1)
        {
            storageData.reloadPageEachTime = false;
            await chrome.storage.local.set(storageData);
            await update_gui();
        }

        storageData.bisectIsInProgress = false;
        storageData.initialExtensions = [];
        storageData.brokenExtIndex = -1;
        storageData.leftIndex = 0;
        storageData.rightIndex = 0;
        storageData.mid = 0;
        await chrome.storage.local.set(storageData);

        if (storageData.reloadPageEachTime) {
            const tabs = await chrome.tabs.query({active: true, currentWindow: true});
            await chrome.tabs.reload(tabs[0].id);
        }

        await update_gui();
    }
})();
