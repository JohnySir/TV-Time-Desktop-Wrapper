// preload.js
window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.innerHTML = `
    /* Push the main body down */
    body {
      padding-top: 30px !important; 
    }
    
    /* 
       CRITICAL FIX: 
       Find any fixed header elements that stick to top:0 and push them down too.
       We target common header tags and classes, plus a generic rule.
    */
    header, nav, .top-bar, .navbar, [class*="header"], [class*="nav"] {
      top: 30px !important; /* Move them below our drag bar */
    }
    
    /* Specifically for TV Time's likely structure if they use specific IDs/Classes */
    /* If they use specific fixed positioning, we force it down */
    
    #electron-drag-region {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 30px;
      background: #1a1a1a;
      color: #666;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1px;
      z-index: 2147483647; /* Maximum z-index to stay on top of EVERYTHING */
      -webkit-app-region: drag;
      user-select: none;
      cursor: default;
      border-bottom: 1px solid #333;
      box-sizing: border-box;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    #electron-drag-region span {
        pointer-events: none;
    }
  `;
  document.head.appendChild(style);

  const div = document.createElement('div');
  div.id = 'electron-drag-region';
  div.innerHTML = '<span>TV TIME</span>';
  document.body.appendChild(div);
});