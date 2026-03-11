'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

interface AllocationLayer {
  label: string;
  percent: number;
  color: string;
}

interface AllocationPyramidProps {
  layers: AllocationLayer[];
}

export function AllocationPyramid({ layers }: AllocationPyramidProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.2;
    }
  });

  const sortedLayers = [...layers].sort((a, b) => b.percent - a.percent);
  let yOffset = 0;

  return (
    <group ref={groupRef}>
      {sortedLayers.map((layer, i) => {
        const height = Math.max(0.2, layer.percent / 25);
        const width = 2 - i * 0.3;
        const y = yOffset + height / 2;
        yOffset += height + 0.05;

        return (
          <group key={layer.label} position={[0, y - 1.5, 0]}>
            <RoundedBox args={[width, height, width * 0.6]} radius={0.05}>
              <meshStandardMaterial color={layer.color} transparent opacity={0.85} />
            </RoundedBox>
            <Text
              position={[0, 0, width * 0.31]}
              fontSize={0.12}
              color="white"
              anchorX="center"
              anchorY="middle"
            >
              {layer.label} ({layer.percent}%)
            </Text>
          </group>
        );
      })}
    </group>
  );
}
