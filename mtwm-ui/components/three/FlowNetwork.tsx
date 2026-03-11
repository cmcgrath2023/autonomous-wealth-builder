'use client';

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere, Line, Text } from '@react-three/drei';
import * as THREE from 'three';

interface FlowNode {
  id: string;
  label: string;
  value: number;
  position: [number, number, number];
  color: string;
}

interface FlowEdge {
  from: string;
  to: string;
  volume: number;
}

interface FlowNetworkProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export function FlowNetwork({ nodes, edges }: FlowNetworkProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.2) * 0.15;
    }
  });

  const edgeLines = useMemo(() => {
    return edges.map((edge) => {
      const from = nodes.find((n) => n.id === edge.from);
      const to = nodes.find((n) => n.id === edge.to);
      if (!from || !to) return null;
      return { ...edge, points: [new THREE.Vector3(...from.position), new THREE.Vector3(...to.position)] };
    }).filter(Boolean) as (FlowEdge & { points: THREE.Vector3[] })[];
  }, [nodes, edges]);

  return (
    <group ref={groupRef}>
      {nodes.map((node) => (
        <group key={node.id} position={node.position}>
          <Sphere args={[Math.max(0.1, node.value * 0.002), 16, 16]}>
            <meshStandardMaterial color={node.color} emissive={node.color} emissiveIntensity={0.4} />
          </Sphere>
          <Text position={[0, 0.25, 0]} fontSize={0.1} color="white" anchorX="center">
            {node.label}
          </Text>
        </group>
      ))}
      {edgeLines.map((edge, i) => (
        <Line key={i} points={edge.points} color="#475569" lineWidth={Math.max(1, edge.volume * 0.01)} opacity={0.5} transparent />
      ))}
    </group>
  );
}
