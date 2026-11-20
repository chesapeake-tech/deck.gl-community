// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {WebMercatorViewport} from '@deck.gl/core';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {CubeGeometry} from '@luma.gl/engine';
import type {Scene} from '../ambient-occlusion/scenes';

const CUBE = new CubeGeometry();
const COLORS: [number, number, number][] = [
  [255, 20, 60],
  [0, 255, 255],
  [255, 0, 255],
  [255, 230, 0],
  [30, 80, 255],
  [40, 255, 20]
];
const CUBES = Array.from({length: 12}, (_, index) => index);
const POLES = [0, 1, 2, 3];

/** Constant-speed travel along a segment, with deterministic reversals at its ends. */
function getTravel(time: number, speed: number, phase: number): number {
  const distance = (((time * speed + phase) % 800) + 800) % 800;
  return 200 - Math.abs(distance - 400);
}

/** Builds the attribute-animated cubes and the rigidly translated thin features. */
export function createMovingLayers(scene: Scene, time: number, objectVelocity: boolean) {
  const {longitude, latitude, zoom, bearing = 0} = scene.viewState;
  // Keep the overlay in view in the close-up primitives and wide terrain/bike scenes.
  const scale = 2 ** (16.7 - zoom);
  const altitude = scene.id === 'terrain' ? 2400 : 0;
  const angle = (bearing * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = -Math.sin(angle);
  const origin: [number, number, number] = [longitude, latitude, altitude];
  const viewport = new WebMercatorViewport({...scene.viewState, width: 1920, height: 1080});
  const metersPerDegree = 111320;
  const longitudeScale = metersPerDegree * Math.cos((latitude * Math.PI) / 180);
  // Calibrate at each track center against the requested 1080p default camera.
  const getSpeed = (index: number): number => {
    const y = (Math.floor(index / 4) - 1) * 110 * scale;
    const z = altitude + (70 + (index % 3) * 25) * scale;
    const start = viewport.project([longitude, latitude + y / metersPerDegree, z]);
    const end = viewport.project([
      longitude + (dx * scale) / longitudeScale,
      latitude + (y + dy * scale) / metersPerDegree,
      z
    ]);
    return (60 * (1 + (7 * index) / 11)) / Math.hypot(end[0] - start[0], end[1] - start[1]);
  };
  const common = {
    mesh: CUBE,
    // The local deck.gl v10 source spells COORDINATE_SYSTEM.METER_OFFSETS as a string.
    coordinateSystem: 'meter-offsets' as const,
    coordinateOrigin: origin,
    // This experimental prop comes from the local deck.gl source.
    _motionVectors: objectVelocity,
    material: false as const
  };
  const translation = getTravel(time, getSpeed(6), 150) * scale;
  return [
    new SimpleMeshLayer<number>({
      ...common,
      id: 'moving-cubes',
      data: CUBES,
      getPosition: index => {
        const travel = getTravel(time, getSpeed(index), index * 61) * scale;
        return [
          ((index % 4) - 1.5) * 65 * scale + dx * travel,
          (Math.floor(index / 4) - 1) * 110 * scale + dy * travel,
          (70 + (index % 3) * 25) * scale
        ];
      },
      getScale: [15 * scale, 15 * scale, 15 * scale],
      getColor: index => COLORS[index % COLORS.length],
      updateTriggers: {getPosition: [time, scene.id]}
    }),
    new SimpleMeshLayer<number>({
      ...common,
      id: 'moving-rigid',
      data: POLES,
      getPosition: index => [(index - 1.5) * 65 * scale, -160 * scale, 80 * scale],
      getScale: [scale, scale, 60 * scale],
      getColor: index => COLORS[(index + 2) % COLORS.length],
      modelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx * translation, dy * translation, 0, 1],
      updateTriggers: {getPosition: [scene.id]}
    })
  ];
}
