import { Link, useParams } from 'react-router-dom';

import Minimap from './Minimap';

interface MapSpotProps {
  x: number;
  y: number;
  z?: number;
  areaId?: string;
  title?: string;
  instanceName?: string;
  instanceID?: number;
  size?: number;
  extent?: number;
}

export default function MapSpot({
  x,
  y,
  z = 0,
  areaId = '',
  title,
  instanceName = '',
  instanceID = 0,
  size = 256,
  extent,
}: MapSpotProps) {
  const { build = '' } = useParams();
  const map = <Minimap x={x} y={y} size={size} extent={extent} title={title} />;
  const canLink = build && areaId;

  return (
    <span className="map-spot">
      {canLink ? <Link to={`/${build}/areas/${areaId}`}>{map}</Link> : map}
      <span className="map-spot-coordinates">({x}, {y}, {z})</span>
      {(instanceName || instanceID > 0) && (
        <span className="map-spot-instance">{instanceName || `Instance ${instanceID}`}</span>
      )}
    </span>
  );
}
