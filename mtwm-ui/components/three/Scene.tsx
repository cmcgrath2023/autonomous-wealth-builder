'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Environment } from '@react-three/drei';
import { Suspense, ReactNode } from 'react';

interface SceneProps {
  children: ReactNode;
  controls?: boolean;
  className?: string;
}

export function Scene({ children, controls = true, className = 'w-full h-full' }: SceneProps) {
  return (
    <Canvas className={className}>
      <PerspectiveCamera makeDefault position={[0, 2, 5]} />
      {controls && <OrbitControls enablePan={false} maxDistance={8} minDistance={2} />}
      <Environment preset="night" />
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
      <Suspense fallback={null}>{children}</Suspense>
    </Canvas>
  );
}
