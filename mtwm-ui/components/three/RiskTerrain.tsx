'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface RiskData {
  x: number;
  z: number;
  risk: number;
}

interface RiskTerrainProps {
  data: RiskData[];
  width?: number;
  depth?: number;
}

export function RiskTerrain({ data, width = 10, depth = 10 }: RiskTerrainProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(width, depth, 50, 50);
    const positions = geo.attributes.position;

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getY(i);
      let height = 0;
      let totalWeight = 0;

      data.forEach((point) => {
        const dist = Math.sqrt(
          Math.pow((x / width) * 10 - point.x, 2) + Math.pow((z / depth) * 10 - point.z, 2)
        );
        const weight = 1 / (dist + 0.1);
        height += point.risk * weight;
        totalWeight += weight;
      });

      positions.setZ(i, (height / totalWeight) * 2);
    }

    geo.computeVertexNormals();

    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      const h = positions.getZ(i) / 2;
      const color = new THREE.Color();
      color.setHSL(h < 0.5 ? 0.3 - h * 0.3 : 0.15 - (h - 0.5) * 0.3, 0.8, 0.5);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [data, width, depth]);

  useFrame((state) => {
    if (meshRef.current) meshRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.1) * 0.02;
  });

  return (
    <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}
