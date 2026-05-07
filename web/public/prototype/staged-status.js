(function () {
  function createStagedStatus(options) {
    const timers = [];
    const setMessage = options.setMessage;
    const stages = options.stages || [];

    function clear() {
      while (timers.length > 0) {
        window.clearTimeout(timers.pop());
      }
    }

    function start() {
      clear();
      stages.forEach((stage, index) => {
        const run = () => setMessage(stage);
        if (index === 0 || stage.delay === 0) {
          run();
        } else {
          timers.push(window.setTimeout(run, stage.delay));
        }
      });
    }

    return {
      start,
      stop: clear
    };
  }

  function loadingStages(label) {
    return [
      { delay: 0, type: 'info', message: `正在載入${label}...` },
      { delay: 15000, type: 'info', message: `正在載入${label}...等待中...` },
      { delay: 30000, type: 'warning', message: `正在載入${label}...等待中...請稍候...` },
      { delay: 45000, type: 'warning', message: `載入${label}花費較久，本機資料庫可能正在回應，請再稍候。` }
    ];
  }

  function writingStages(label) {
    return [
      { delay: 0, type: 'info', message: `正在${label}...` },
      { delay: 15000, type: 'info', message: `正在${label}...等待資料庫回應...` },
      { delay: 30000, type: 'warning', message: `正在${label}...等待中...請稍候，不要重複送出。` },
      { delay: 45000, type: 'warning', message: `${label}花費較久，可能正在處理圖片或等待 MySQL 回應。` }
    ];
  }

  window.createStagedStatus = createStagedStatus;
  window.loadingStages = loadingStages;
  window.writingStages = writingStages;
})();
