'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere, Html } from '@react-three/drei';
import * as THREE from 'three';

interface Asset {
  id: string;
  name: string;
  value: number;
  change: number;
  category: string;
  lat: number;
  lng: number;
}

interface PortfolioGlobeProps {
  assets: Asset[];
  totalValue: number;
}

const categoryColors: Record<string, string> = {
  equity: '#3b82f6',
  real_estate: '#10b981',
  crypto: '#f59e0b',
  cash: '#6b7280',
  alternative: '#8b5cf6',
  commodity: '#ef4444',
};

export function PortfolioGlobe({ assets, totalValue }: PortfolioGlobeProps) {
  const globeRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (globeRef.current) globeRef.current.rotation.y += 0.001;
    if (pulseRef.current) {
      pulseRef.current.scale.setScalar(1 + Math.sin(Date.now() * 0.002) * 0.02);
    }
  });

  // Filter to non-cash assets for positioning, keep cash for display
  const tradedAssets = assets.filter(a => a.category !== 'cash');
  const cashAsset = assets.find(a => a.category === 'cash');
  const safeTotal = totalValue || 1;

  const assetPoints = useMemo(() => {
    if (tradedAssets.length === 0 && cashAsset) {
      // No positions — show cash as a pulsing center node
      return [{
        ...cashAsset,
        position: new THREE.Vector3(0, 1.15, 0),
        size: 0.08,
      }];
    }

    return tradedAssets.map((asset) => {
      const phi = (90 - (asset.lat || 0)) * (Math.PI / 180);
      const theta = ((asset.lng || 0) + 180) * (Math.PI / 180);
      const r = 1.02;
      return {
        ...asset,
        position: new THREE.Vector3(
          -r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta)
        ),
        size: Math.max(0.02, Math.min(0.12, (asset.value / safeTotal) * 0.15)),
      };
    });
  }, [tradedAssets, cashAsset, safeTotal]);

  return (
    <group>
      <Sphere ref={globeRef} args={[1, 64, 64]}>
        <meshStandardMaterial color="#0f172a" transparent opacity={0.9} />
      </Sphere>
      <Sphere args={[1.01, 32, 32]}>
        <meshBasicMaterial color="#1e40af" wireframe transparent opacity={0.2} />
      </Sphere>

      {/* Scanning ring — shows the system is actively hunting */}
      <mesh ref={pulseRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.05, 1.07, 64]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>

      {assetPoints.map((asset) => (
        <group key={asset.id} position={asset.position}>
          <Sphere args={[asset.size, 16, 16]}>
            <meshStandardMaterial
              color={categoryColors[asset.category] || '#6b7280'}
              emissive={categoryColors[asset.category] || '#6b7280'}
              emissiveIntensity={0.6}
            />
          </Sphere>
          <Html distanceFactor={3}>
            <div className="bg-slate-900/90 backdrop-blur text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap border border-slate-700/50">
              <div className="font-semibold">{asset.name}</div>
              {asset.category === 'cash' ? (
                <div className="text-blue-400">${(asset.value || 0).toLocaleString()}</div>
              ) : (
                <div className={(asset.change || 0) >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {(asset.change || 0) >= 0 ? '+' : ''}{(asset.change || 0).toFixed(2)}%
                </div>
              )}
            </div>
          </Html>
        </group>
      ))}

      {/* Status label when no positions */}
      {tradedAssets.length === 0 && (
        <Html position={[0, -1.3, 0]} center>
          <div className="text-[10px] text-blue-400/60 whitespace-nowrap animate-pulse">
            Scanning markets for opportunities...
          </div>
        </Html>
      )}
    </group>
  );
}
