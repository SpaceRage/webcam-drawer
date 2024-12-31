"use client";

import { Card } from "@/components/ui/card";
import { useEffect, useRef, useState } from "react";

type HandLandmark = {
  x: number;
  y: number;
  z: number;
};

const HandTrackingComponent = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [isPinching, setIsPinching] = useState(false);
  const videoFrameRef = useRef<number>(0);
  const detectFrameRef = useRef<number>(0);
  const lastProcessTimestamp = useRef(0);
  const currentLandmarksRef = useRef<HandLandmark[][]>([]);
  const PROCESS_INTERVAL = 100;
  const PINCH_THRESHOLD = 0.05;
  const localDrawnPoints: { x: number; y: number }[] = [];

  const WIDTH = 1920;
  const HEIGHT = 1280;

  const calculateDistance = (point1: HandLandmark, point2: HandLandmark) => {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    const dz = point1.z - point2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  useEffect(() => {
    const initializeHandTracking = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: WIDTH,
            height: HEIGHT,
            frameRate: { ideal: 30 },
          },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise((resolve) => {
            if (videoRef.current) {
              videoRef.current.onloadedmetadata = resolve;
            }
          });
          videoRef.current.play();
        }

        const vision = await import("@mediapipe/tasks-vision");

        const filesetResolver = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        const handLandmarker = await vision.HandLandmarker.createFromOptions(
          filesetResolver,
          {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            numHands: 1,
          }
        );

        const renderVideo = () => {
          if (!videoRef.current || !canvasRef.current) return;

          const ctx = canvasRef.current.getContext("2d");
          if (ctx) {
            ctx.save();
            ctx.reset();
            ctx.globalAlpha = 0.5;
            ctx.scale(-1, 1);
            ctx.translate(-canvasRef.current.width, 0);
            ctx.drawImage(
              videoRef.current,
              0,
              0,
              canvasRef.current.width,
              canvasRef.current.height
            );
            ctx.restore();
          }

          videoFrameRef.current = requestAnimationFrame(renderVideo);
        };

        const detectFrame = async () => {
          if (!videoRef.current || !overlayCanvasRef.current) return;

          const currentTime = Date.now();
          if (currentTime - lastProcessTimestamp.current >= PROCESS_INTERVAL) {
            const results = await handLandmarker.detectForVideo(
              videoRef.current,
              currentTime
            );

            if (results.landmarks) {
              currentLandmarksRef.current = results.landmarks;
              renderLandmarks();
            }

            lastProcessTimestamp.current = currentTime;
          }

          detectFrameRef.current = requestAnimationFrame(detectFrame);
        };

        const renderLandmarks = () => {
          if (!overlayCanvasRef.current) return;

          const ctx = overlayCanvasRef.current.getContext("2d");
          if (!ctx) return;

          ctx.clearRect(
            0,
            0,
            overlayCanvasRef.current.width,
            overlayCanvasRef.current.height
          );

          currentLandmarksRef.current.forEach((landmarks: HandLandmark[]) => {
            const thumbTip = landmarks[4];
            const indexTip = landmarks[8];

            if (!thumbTip || !indexTip) return;

            const distance = calculateDistance(thumbTip, indexTip);
            const isPinchGesture = distance < PINCH_THRESHOLD;
            setIsPinching(isPinchGesture);

            if (isPinchGesture) {
              localDrawnPoints.push({
                x: (1 - indexTip.x) * overlayCanvasRef.current!.width,
                y: indexTip.y * overlayCanvasRef.current!.height,
              });
            }

            ctx.beginPath();
            ctx.arc(
              (1 - thumbTip.x) * overlayCanvasRef.current!.width,
              thumbTip.y * overlayCanvasRef.current!.height,
              6,
              0,
              2 * Math.PI
            );
            ctx.fillStyle = "#00FF00";
            ctx.fill();

            ctx.beginPath();
            ctx.arc(
              (1 - indexTip.x) * overlayCanvasRef.current!.width,
              indexTip.y * overlayCanvasRef.current!.height,
              6,
              0,
              2 * Math.PI
            );
            ctx.fillStyle = "#FF0000";
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(
              (1 - thumbTip.x) * overlayCanvasRef.current!.width,
              thumbTip.y * overlayCanvasRef.current!.height
            );
            ctx.lineTo(
              (1 - indexTip.x) * overlayCanvasRef.current!.width,
              indexTip.y * overlayCanvasRef.current!.height
            );
            ctx.strokeStyle = isPinchGesture ? "#FFFF00" : "#FFFFFF";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.font = "14px Arial";
            ctx.fillStyle = isPinchGesture ? "#FFFF00" : "#FFFFFF";
            ctx.fillText(
              `Status: ${isPinchGesture ? "PINCHING" : "OPEN"}`,
              10,
              20
            );
            ctx.fillText(`Distance: ${distance.toFixed(3)}`, 10, 40);
          });

          const SMOOTHING_FACTOR = 0.8;

          const smoothPoints = (points: { x: number; y: number }[]) => {
            const smoothedPoints: { x: number; y: number }[] = [];

            for (let i = 0; i < points.length; i++) {
              if (i === 0) {
                smoothedPoints.push(points[i]);
              } else {
                const previous = smoothedPoints[i - 1];
                const current = points[i];

                const smoothedPoint = {
                  x: previous.x + SMOOTHING_FACTOR * (current.x - previous.x),
                  y: previous.y + SMOOTHING_FACTOR * (current.y - previous.y),
                };

                smoothedPoints.push(smoothedPoint);
              }
            }

            return smoothedPoints;
          };

          const smoothedPoints = smoothPoints(localDrawnPoints);

          const drawSmoothedLines = (
            ctx: CanvasRenderingContext2D,
            points: { x: number; y: number }[]
          ) => {
            points.forEach((point, index) => {
              if (index === 0) {
                ctx.beginPath();
                ctx.moveTo(point.x, point.y);
              } else {
                if (
                  calculateDistance(
                    { ...points[index - 1], z: 0 },
                    { ...point, z: 0 }
                  ) > 75
                ) {
                  ctx.moveTo(point.x, point.y);
                } else {
                  ctx.lineTo(point.x, point.y);
                }
              }
            });
            ctx.lineWidth = 6;
            ctx.strokeStyle = "#0000FF";
            ctx.stroke();
          };

          drawSmoothedLines(ctx, smoothedPoints);
        };

        setIsLoading(false);
        renderVideo();
        detectFrame();
      } catch (err) {
        setError(
          "Failed to initialize hand tracking: " + (err as Error).message
        );
        setIsLoading(false);
        console.error(err);
      }
    };

    initializeHandTracking();

    return () => {
      if (videoFrameRef.current) {
        cancelAnimationFrame(videoFrameRef.current);
      }
      if (detectFrameRef.current) {
        cancelAnimationFrame(detectFrameRef.current);
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <Card className="p-0 w-full mx-auto">
      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 text-white">
            Loading hand tracking...
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-500 bg-opacity-50 text-white">
            {error}
          </div>
        )}
        <video ref={videoRef} className="w-full hidden" playsInline />
        <canvas
          ref={canvasRef}
          className="w-fit border rounded absolute top-0 left-0"
          width={WIDTH}
          height={HEIGHT}
        />
        <canvas
          ref={overlayCanvasRef}
          className="w-fit border rounded absolute top-0 left-0"
          width={WIDTH}
          height={HEIGHT}
        />
      </div>
    </Card>
  );
};

export default HandTrackingComponent;
