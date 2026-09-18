import React from 'react';
import SplineScene from './SplineScene';

export default function SplineMiniOrb({
  isActive = false,
  palette = 'cyber-neon',
  onClick,
}) {
  return (
    <div
      className={`spline-mini-orb-wrap ${isActive ? 'active-pulse' : ''}`}
      onClick={onClick}
      title={isActive ? 'Spark Agent is processing...' : 'Spark 3D AI Core (Click to customize)'}
    >
      <div className="mini-orb-inner">
        <SplineScene
          mode="orb"
          interactive={false}
          palette={palette}
        />
      </div>

      {isActive && (
        <div className="mini-orb-pulse-rings">
          <span className="pulse-ring ring-1" />
          <span className="pulse-ring ring-2" />
        </div>
      )}
    </div>
  );
}
