import React, { useEffect, useRef, useState } from 'react';
import { Application } from '@splinetool/runtime';

/**
 * SplineScene Component
 * 
 * Embeds an interactive 3D Spline runtime scene or high-performance interactive 
 * Canvas 3D particle/wireframe holographic geometry with mouse tracking.
 */
export default function SplineScene({
  sceneUrl = 'https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode',
  className = '',
  interactive = true,
  mode = 'hero', // 'hero' | 'orb' | 'ambient'
  palette = 'cyber-neon',
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [splineLoaded, setSplineLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const splineAppRef = useRef(null);
  const animationFrameRef = useRef(null);
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0, hover: false });

  // Color mappings for the interactive 3D canvas engine
  const getThemeColors = (p) => {
    switch (p) {
      case 'synthwave':
        return {
          primary: '#f43f5e',
          secondary: '#d946ef',
          accent: '#38bdf8',
          particleAlpha: 0.7,
        };
      case 'matrix-emerald':
        return {
          primary: '#10b981',
          secondary: '#34d399',
          accent: '#06b6d4',
          particleAlpha: 0.75,
        };
      case 'deep-space':
        return {
          primary: '#3b82f6',
          secondary: '#06b6d4',
          accent: '#6366f1',
          particleAlpha: 0.7,
        };
      case 'high-contrast':
        return {
          primary: '#38bdf8',
          secondary: '#ffffff',
          accent: '#38bdf8',
          particleAlpha: 0.85,
        };
      case 'cyber-neon':
      default:
        return {
          primary: '#8b5cf6',
          secondary: '#06b6d4',
          accent: '#ec4899',
          particleAlpha: 0.75,
        };
    }
  };

  // 1. Attempt loading Spline Runtime if valid sceneUrl is provided
  useEffect(() => {
    let isMounted = true;
    const canvas = canvasRef.current;
    if (!canvas || !sceneUrl) return;

    const timeout = setTimeout(async () => {
      try {
        const app = new Application(canvas);
        splineAppRef.current = app;
        await app.load(sceneUrl);
        if (isMounted) {
          setSplineLoaded(true);
          setLoadError(false);
        }
      } catch (err) {
        console.warn('Spline runtime load note (rendering interactive 3D canvas fallback):', err);
        if (isMounted) {
          setLoadError(true);
          setSplineLoaded(false);
        }
      }
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timeout);
      if (splineAppRef.current) {
        try {
          splineAppRef.current.dispose();
        } catch {
          // ignore cleanup error
        }
        splineAppRef.current = null;
      }
    };
  }, [sceneUrl]);

  // 2. High-performance Canvas 3D Holographic / Particle Engine
  // Renders while Spline is loading or as resilient 3D fallback
  useEffect(() => {
    if (splineLoaded) return; // If Spline runtime has taken over the canvas, let it drive
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = canvas.parentElement?.clientWidth || 400);
    let height = (canvas.height = canvas.parentElement?.clientHeight || 400);

    const handleResize = () => {
      if (!canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
    };
    window.addEventListener('resize', handleResize);

    // Generate 3D nodes for a glowing geodesic sphere & orbital ring particles
    const nodeCount = mode === 'orb' ? 24 : 54;
    const nodes = [];
    const phi = Math.PI * (3 - Math.sqrt(5)); // Golden ratio angle

    const radius = mode === 'orb' ? 28 : Math.min(width, height) * 0.28;

    for (let i = 0; i < nodeCount; i++) {
      const y = 1 - (i / (nodeCount - 1)) * 2;
      const radiusAtY = Math.sqrt(1 - y * y);
      const theta = phi * i;
      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;
      nodes.push({ x: x * radius, y: y * radius, z: z * radius });
    }

    // Rings particles
    const ringParticles = [];
    const ringCount = mode === 'orb' ? 16 : 40;
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2;
      ringParticles.push({
        angle,
        distance: radius * (1.35 + (i % 3) * 0.15),
        speed: 0.008 + (i % 4) * 0.004,
        size: (i % 2 === 0 ? 2 : 1.2),
        yOffset: Math.sin(angle * 3) * (radius * 0.2),
      });
    }

    let rotX = 0.2;
    let rotY = 0;
    let rotZ = 0;

    const render = () => {
      // Smooth mouse lerp
      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.08;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.08;

      rotY += 0.009 + mouseRef.current.x * 0.02;
      rotX += 0.004 + mouseRef.current.y * 0.015;
      rotZ += 0.002;

      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const colors = getThemeColors(palette);

      // Ambient radial glow behind the 3D model
      const glowGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        radius * 0.1,
        centerX,
        centerY,
        radius * 1.8
      );
      glowGrad.addColorStop(0, `${colors.primary}25`);
      glowGrad.addColorStop(0.5, `${colors.secondary}12`);
      glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, width, height);

      // Project 3D nodes
      const projected = nodes.map((node) => {
        // Rotate around Y
        let x1 = node.x * Math.cos(rotY) - node.z * Math.sin(rotY);
        let z1 = node.z * Math.cos(rotY) + node.x * Math.sin(rotY);

        // Rotate around X
        let y2 = node.y * Math.cos(rotX) - z1 * Math.sin(rotX);
        let z2 = z1 * Math.cos(rotX) + node.y * Math.sin(rotX);

        // Rotate around Z
        let x3 = x1 * Math.cos(rotZ) - y2 * Math.sin(rotZ);
        let y3 = y2 * Math.cos(rotZ) + x1 * Math.sin(rotZ);

        const fov = 350;
        const scale = fov / (fov + z2);
        return {
          x: centerX + x3 * scale,
          y: centerY + y3 * scale,
          z: z2,
          scale,
          alpha: Math.max(0.15, (z2 + radius) / (2 * radius)),
        };
      });

      // Draw wireframe connecting lines between close nodes
      ctx.lineWidth = mode === 'orb' ? 0.75 : 1;
      for (let i = 0; i < projected.length; i++) {
        for (let j = i + 1; j < projected.length; j++) {
          const dx = projected[i].x - projected[j].x;
          const dy = projected[i].y - projected[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = mode === 'orb' ? 22 : 65;

          if (dist < maxDist) {
            const lineAlpha = (1 - dist / maxDist) * 0.35 * Math.min(projected[i].alpha, projected[j].alpha);
            ctx.strokeStyle = `${colors.secondary}${Math.round(lineAlpha * 255).toString(16).padStart(2, '0')}`;
            ctx.beginPath();
            ctx.moveTo(projected[i].x, projected[i].y);
            ctx.lineTo(projected[j].x, projected[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw projected nodes
      for (const p of projected) {
        ctx.beginPath();
        const nodeSize = (mode === 'orb' ? 1.5 : 2.6) * p.scale;
        ctx.arc(p.x, p.y, nodeSize, 0, Math.PI * 2);
        ctx.fillStyle = p.z > 0 ? colors.primary : colors.secondary;
        ctx.shadowColor = colors.primary;
        ctx.shadowBlur = p.z > 0 ? 8 : 2;
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Draw outer glowing orbit rings
      for (const rp of ringParticles) {
        rp.angle += rp.speed;
        const rx = Math.cos(rp.angle) * rp.distance;
        const rz = Math.sin(rp.angle) * rp.distance;
        const ry = rp.yOffset;

        // Apply rotation
        let x1 = rx * Math.cos(rotY * 0.7) - rz * Math.sin(rotY * 0.7);
        let z1 = rz * Math.cos(rotY * 0.7) + rx * Math.sin(rotY * 0.7);
        let y2 = ry * Math.cos(rotX) - z1 * Math.sin(rotX);
        let z2 = z1 * Math.cos(rotX) + ry * Math.sin(rotX);

        const fov = 350;
        const scale = fov / (fov + z2);
        const px = centerX + x1 * scale;
        const py = centerY + y2 * scale;

        ctx.beginPath();
        ctx.arc(px, py, rp.size * scale, 0, Math.PI * 2);
        ctx.fillStyle = colors.accent;
        ctx.shadowColor = colors.accent;
        ctx.shadowBlur = 6;
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [splineLoaded, mode, palette]);

  // Mouse move handler for interactive 3D rotation
  const handleMouseMove = (e) => {
    if (!interactive) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    mouseRef.current.targetX = x;
    mouseRef.current.targetY = y;
  };

  const handleMouseLeave = () => {
    mouseRef.current.targetX = 0;
    mouseRef.current.targetY = 0;
  };

  return (
    <div
      ref={containerRef}
      className={`spline-scene-container ${className} ${mode}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: interactive ? 'grab' : 'default',
        }}
      />
      {!splineLoaded && !loadError && (
        <div className="spline-loading-badge">
          <span className="spline-loading-pulse" />
          <span>3D Runtime Active</span>
        </div>
      )}
    </div>
  );
}
