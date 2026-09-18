import React, { useState, useEffect } from 'react';
import { X, Moon, Sun, Code, Check, RotateCcw, HelpCircle } from 'lucide-react';

export default function AppearanceModal({
  isOpen,
  onClose,
  theme,
  onSelectTheme,
}) {
  const [customCss, setCustomCss] = useState(() => localStorage.getItem('spark_user_custom_css') || '');
  const [cssApplied, setCssApplied] = useState(false);

  const handleApplyCustomCss = () => {
    let styleTag = document.getElementById('spark-user-custom-css');
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'spark-user-custom-css';
      document.head.appendChild(styleTag);
    }
    styleTag.innerHTML = customCss;
    localStorage.setItem('spark_user_custom_css', customCss);
    setCssApplied(true);
    setTimeout(() => setCssApplied(false), 2000);
  };

  const handleResetCustomCss = () => {
    setCustomCss('');
    const styleTag = document.getElementById('spark-user-custom-css');
    if (styleTag) styleTag.innerHTML = '';
    localStorage.removeItem('spark_user_custom_css');
  };

  if (!isOpen) return null;

  return (
    <div className="appearance-modal-backdrop" onClick={onClose}>
      <div className="appearance-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="appearance-header">
          <div>
            <div className="appearance-title">Appearance & Custom Styles</div>
            <div className="appearance-subtitle">Switch between Absolute Dark and Warm Cream themes</div>
          </div>
          <button className="appearance-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="appearance-body">
          {/* Theme Selector */}
          <div className="appearance-section-label">Select Theme</div>
          <div className="theme-options-grid">
            {/* Absolute Dark */}
            <div
              className={`theme-option-card ${theme === 'dark' ? 'selected' : ''}`}
              onClick={() => onSelectTheme('dark')}
            >
              <div className="theme-preview-box dark">
                <div className="preview-topbar" />
                <div className="preview-content">
                  <div className="preview-sidebar" />
                  <div className="preview-editor" />
                </div>
              </div>
              <div className="theme-option-meta">
                <div className="theme-option-name">
                  <Moon size={14} /> Absolute Dark
                </div>
                <div className="theme-option-desc">
                  OLED pitch-black background with subtle charcoal surfaces and hairline borders.
                </div>
              </div>
              {theme === 'dark' && <div className="theme-selected-check"><Check size={14} /></div>}
            </div>

            {/* Warm Cream */}
            <div
              className={`theme-option-card ${theme === 'cream' ? 'selected' : ''}`}
              onClick={() => onSelectTheme('cream')}
            >
              <div className="theme-preview-box cream">
                <div className="preview-topbar" />
                <div className="preview-content">
                  <div className="preview-sidebar" />
                  <div className="preview-editor" />
                </div>
              </div>
              <div className="theme-option-meta">
                <div className="theme-option-name">
                  <Sun size={14} /> Warm Cream
                </div>
                <div className="theme-option-desc">
                  Soft ivory off-white parchment with warm stone tones and slate typography.
                </div>
              </div>
              {theme === 'cream' && <div className="theme-selected-check"><Check size={14} /></div>}
            </div>
          </div>

          {/* Custom CSS Editor */}
          <div className="appearance-section-label" style={{ marginTop: 24 }}>
            Custom CSS Stylesheet
          </div>
          <div className="custom-css-notice">
            <HelpCircle size={14} className="notice-icon" />
            <span>
              You can paste your custom CSS overrides here or provide custom HTML/CSS/JS files directly. Overrides are applied instantly and saved locally.
            </span>
          </div>
          <textarea
            className="appearance-css-editor"
            rows={5}
            placeholder={`/* Example custom CSS */\n.ide-titlebar { font-weight: 600; }`}
            value={customCss}
            onChange={(e) => setCustomCss(e.target.value)}
          />

          <div className="appearance-actions-row">
            <button
              className={`appearance-btn primary ${cssApplied ? 'success' : ''}`}
              onClick={handleApplyCustomCss}
            >
              {cssApplied ? '✓ Applied Live' : 'Apply Custom CSS'}
            </button>
            <button className="appearance-btn secondary" onClick={handleResetCustomCss}>
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="appearance-footer">
          <div className="theme-status-text">
            Current: <strong>{theme === 'cream' ? 'Warm Cream' : 'Absolute Dark'}</strong>
          </div>
          <button className="appearance-btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
