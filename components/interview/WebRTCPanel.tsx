"use client";

import { useEffect, useRef, useState } from "react";

import type { Socket } from "socket.io-client";

import {
  Camera,
  CameraOff,
  Clock3,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  Radio,
  Sparkles,
  Users,
} from "lucide-react";

import { getSocket } from "@/lib/socket/client";
type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;

  start: () => void;
  stop: () => void;
  abort: () => void;

  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: Event) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}
type UserRole = "CANDIDATE" | "INTERVIEWER" | "ADMIN";

type Props = {
  roomId: string;
  userName: string;
  userRole: UserRole;
};

type SignalDescription = {
  type: RTCSdpType;
  sdp: string;
};

type AIStatus = "IDLE" | "SPEAKING" | "LISTENING" | "THINKING" | "PAUSED";

type InterviewState = {
  roomId: string;
  state: string;
  aiStatus: AIStatus;
  currentQuestion: string | null;
  currentSpeaker: "SYSTEM" | "AI" | "CANDIDATE" | "HUMAN";
  questionNumber: number;
  startedAt: string | null;
  updatedAt: string;
  aiPausedByHuman: boolean;
};

type TranscriptItem = {
  speaker: string;
  text: string;
  timestamp: string;
};

type InterimTranscript = {
  speaker: string;
  text: string;
};

type RemoteParticipant = {
  name: string;
  role: UserRole;
};

function getInitials(name: string) {
  const cleanName = name.trim();

  if (!cleanName) {
    return "U";
  }

  const parts = cleanName.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }

  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatElapsedTime(startedAt: string | null) {
  if (!startedAt) {
    return "00:00";
  }

  const start = new Date(startedAt).getTime();

  const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));

  const minutes = Math.floor(elapsed / 60);

  const seconds = elapsed % 60;

  return `${String(minutes).padStart(
    2,
    "0",
  )}:${String(seconds).padStart(2, "0")}`;
}

function ElapsedTimer({ startedAt }: { startedAt: string | null }) {
  const [elapsedTime, setElapsedTime] = useState(() => formatElapsedTime(startedAt));

  useEffect(() => {
    const update = () => setElapsedTime(formatElapsedTime(startedAt));
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  return <>{elapsedTime}</>;
}

function getAIStatusLabel(status: AIStatus) {
  switch (status) {
    case "SPEAKING":
      return "Speaking";

    case "LISTENING":
      return "Listening";

    case "THINKING":
      return "Thinking";

    case "PAUSED":
      return "Paused";

    default:
      return "Ready";
  }
}

export default function WebRTCPanel({ roomId, userName, userRole }: Props) {
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const socketRef = useRef<Socket | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);

  const remoteSocketIdRef = useRef<string | null>(null);

  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const currentQuestionRef = useRef<string | null>(null);

  const [socketConnected, setSocketConnected] = useState(false);

  const [remoteConnected, setRemoteConnected] = useState(false);

  const [cameraOn, setCameraOn] = useState(false);

  const [micOn, setMicOn] = useState(false);

  const [screenSharing, setScreenSharing] = useState(false);

  const [error, setError] = useState("");
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  const [participantCount, setParticipantCount] = useState(1);

  const [remoteParticipant, setRemoteParticipant] =
    useState<RemoteParticipant | null>(null);

  const [interviewState, setInterviewState] = useState<InterviewState>({
    roomId,
    state: "WAITING",
    aiStatus: "IDLE",
    currentQuestion: null,
    currentSpeaker: "SYSTEM",
    questionNumber: 0,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    aiPausedByHuman: false,
  });

  function setAIStatus(status: AIStatus) {
    setInterviewState((previous) => ({
      ...previous,
      aiStatus: status,
      updatedAt: new Date().toISOString(),
    }));
  }

  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<InterimTranscript | null>(null);

  const [answerText, setAnswerText] = useState("");

  const [isListening, setIsListening] = useState(false);
  const [aiVoiceEnabled, setAiVoiceEnabled] = useState(false);
  const aiVoiceEnabledRef = useRef(false);
  const [speechSupported, setSpeechSupported] = useState(true);

  const [interimText, setInterimText] = useState("");

  const speechRecognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const recognitionRestartTimerRef = useRef<number | null>(null);

  const isInterviewer = userRole === "INTERVIEWER" || userRole === "ADMIN";

  function enableAIVoice() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setError("Your browser does not support AI voice.");

      return;
    }

    try {
      window.speechSynthesis.cancel();

      /*
       * This first speech call happens directly
       * because the user clicked the button.
       * It unlocks speech for subsequent AI questions.
       */
      const testUtterance = new SpeechSynthesisUtterance("AI voice enabled.");

      testUtterance.lang = "en-IN";
      testUtterance.volume = 0.01;

      testUtterance.onend = () => {
        aiVoiceEnabledRef.current = true;
        setAiVoiceEnabled(true);
        setError("");
        console.log("AI voice enabled successfully.");

        // If the interviewer enables voice after the intro question has
        // already arrived, speak that active question once now.
        const activeQuestion = currentQuestionRef.current;
        if (activeQuestion) {
          window.setTimeout(() => speakAIQuestion(activeQuestion), 100);
        }
      };

      testUtterance.onerror = (event) => {
        console.error("Could not enable AI voice:", event.error);

        setAiVoiceEnabled(false);

        setError(
          "Browser blocked AI voice. Please check the browser sound permissions.",
        );
      };

      window.speechSynthesis.speak(testUtterance);
    } catch (error) {
      console.error("AI voice initialization failed:", error);

      setError("Could not initialize AI voice.");
    }
  }
  function speakAIQuestion(question: string) {
    if (typeof window === "undefined") {
      return;
    }

    if (!("speechSynthesis" in window)) {
      console.warn("Browser speech synthesis is not available.");
      return;
    }

    if (!aiVoiceEnabledRef.current) {
      setAIStatus("LISTENING");
      return;
    }

    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(question);

      utterance.lang = "en-IN";
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.volume = 1;

      const voices = window.speechSynthesis.getVoices();

      const preferredVoice =
        voices.find((voice) => voice.lang === "en-IN") ||
        voices.find((voice) => voice.lang.startsWith("en"));

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onstart = () => {
        setAIStatus("SPEAKING");
      };

      utterance.onend = () => {
        setAIStatus("LISTENING");
      };

      utterance.onerror = (event) => {
        console.warn("AI speech failed, continuing without voice:", event);

        // IMPORTANT:
        // Speech failure must not stop the interview.
        setAIStatus("LISTENING");
      };

      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn(
        "AI speech could not be started. Continuing without voice:",
        error,
      );

      setAIStatus("LISTENING");
    }
  }
  function handleAIQuestion(data: { question: string }) {
    const question = data.question.trim();

    if (!question) return;

    currentQuestionRef.current = question;
    setInterviewState((previous) => ({
      ...previous,
      currentQuestion: question,
    }));

    // AI speech is controlled by the interviewer only. Candidates still
    // receive the question and state over Socket.IO.
    if (isInterviewer) {
      speakAIQuestion(question);
    }
  }

  // =====================================================
  // ADD TRACK TO PEER
  // =====================================================

  function addLocalTrackToPeer(track: MediaStreamTrack) {
    const peer = peerRef.current;

    if (!peer) {
      return;
    }

    const existingSender = peer
      .getSenders()
      .find((sender) => sender.track?.kind === track.kind);

    if (existingSender) {
      void existingSender.replaceTrack(track);

      return;
    }

    const stream = localStreamRef.current;

    if (stream) {
      peer.addTrack(track, stream);
    }
  }

  // =====================================================
  // RENEGOTIATE PEER
  // =====================================================

  async function renegotiatePeer() {
    const socket = socketRef.current;

    const peer = peerRef.current;

    const targetSocketId = remoteSocketIdRef.current;

    if (!socket || !peer || !targetSocketId) {
      return;
    }

    try {
      const offer = await peer.createOffer();

      await peer.setLocalDescription(offer);

      socket.emit("webrtc-offer", {
        targetSocketId,
        offer: {
          type: offer.type,
          sdp: offer.sdp ?? "",
        } satisfies SignalDescription,
      });
    } catch (error) {
      console.error("WebRTC renegotiation failed:", error);
    }
  }

  // =====================================================
  // CREATE PEER CONNECTION
  // =====================================================

  function createPeerConnection(targetSocketId: string) {
    const socket = socketRef.current;

    if (!socket) {
      throw new Error("Socket is not connected");
    }

    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }

    const peer = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302",
        },
      ],
    });

    peerRef.current = peer;

    remoteSocketIdRef.current = targetSocketId;

    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      socket.emit("webrtc-ice-candidate", {
        targetSocketId,
        candidate: event.candidate.toJSON(),
      });
    };

    peer.ontrack = (event) => {
      const stream = event.streams[0];

      if (stream && remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;

        setRemoteConnected(true);
      }
    };

    peer.onconnectionstatechange = () => {
      console.log("WebRTC connection:", peer.connectionState);

      if (peer.connectionState === "connected") {
        setRemoteConnected(true);
      }

      if (
        peer.connectionState === "failed" ||
        peer.connectionState === "disconnected" ||
        peer.connectionState === "closed"
      ) {
        setRemoteConnected(false);
      }
    };

    const localStream = localStreamRef.current;

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        peer.addTrack(track, localStream);
      });
    }

    return peer;
  }

  // =====================================================
  // CREATE OFFER
  // =====================================================

  async function createOffer(targetSocketId: string) {
    const socket = socketRef.current;

    if (!socket) {
      return;
    }

    try {
      const peer = createPeerConnection(targetSocketId);

      const offer = await peer.createOffer();

      await peer.setLocalDescription(offer);

      socket.emit("webrtc-offer", {
        targetSocketId,
        offer: {
          type: offer.type,
          sdp: offer.sdp ?? "",
        } satisfies SignalDescription,
      });
    } catch (error) {
      console.error("Failed to create WebRTC offer:", error);
    }
  }

  // =====================================================
  // SOCKET SETUP
  // =====================================================

  useEffect(() => {
    const socket = getSocket();

    socketRef.current = socket;

    function handleConnect() {
      console.log("Socket connected:", socket.id);

      setSocketConnected(true);

      socket.emit("join-room", {
        roomId,
        name: userName,
        role: userRole,
      });
    }

    function handleDisconnect() {
      setSocketConnected(false);
      setRemoteConnected(false);
    }

    function handleRoomParticipants(data: { count: number }) {
      setParticipantCount(data.count);
    }

    function handleAIError(data: { message?: string }) {
      setError(data.message?.trim() || "The interview action failed. Please try again.");
    }

    function handleInterviewState(data: InterviewState) {
      currentQuestionRef.current = data.currentQuestion;
      setInterviewState(data);

      // A human takeover, pause, or completed interview must stop speech
      // immediately instead of allowing the previous AI question to continue.
      if (
        isInterviewer &&
        (data.aiPausedByHuman || data.state === "HUMAN_TURN" ||
          data.state === "PAUSED_BY_HUMAN" || data.state === "COMPLETED") &&
        typeof window !== "undefined" &&
        "speechSynthesis" in window
      ) {
        window.speechSynthesis.cancel();
      }
    }

    function handleTranscript(data: TranscriptItem) {
      setTranscript((previous) => [...previous, data].slice(-100));
      setInterimTranscript((previous) =>
        previous?.speaker === data.speaker ? null : previous
      );
    }

    function handleInterimTranscript(data: InterimTranscript) {
      setInterimTranscript(
        data.text.trim() ? { speaker: data.speaker, text: data.text.trim() } : null
      );
    }

    function handleAIStop() {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    }

    function handleQuestionReset() {
      if (isInterviewer && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }

      // Reset must stop candidate capture too, otherwise the browser's
      // auto-restart can keep appending speech to an answer for a cleared question.
      if (userRole === "CANDIDATE") {
        shouldKeepListeningRef.current = false;
        if (recognitionRestartTimerRef.current !== null) {
          window.clearTimeout(recognitionRestartTimerRef.current);
          recognitionRestartTimerRef.current = null;
        }
        try {
          speechRecognitionRef.current?.abort();
        } catch {
          // The recognition session may already have stopped.
        }
        setIsListening(false);
        setAnswerText("");
      }

      setInterimText("");
      setInterimTranscript(null);
      currentQuestionRef.current = null;
      setInterviewState((previous) => ({
        ...previous,
        currentQuestion: null,
      }));
    }

    function handleExistingPeer(data: {
      socketId: string;
      name?: string;
      role?: UserRole;
    }) {
      remoteSocketIdRef.current = data.socketId;

      if (data.name && data.role) {
        setRemoteParticipant({
          name: data.name,
          role: data.role,
        });
      }

      // If the user already enabled
      // camera/mic, create the offer.
      if (localStreamRef.current) {
        void createOffer(data.socketId);
      }
    }

    function handlePeerJoined(data: {
      socketId: string;
      name?: string;
      role?: UserRole;
    }) {
      remoteSocketIdRef.current = data.socketId;

      if (data.name && data.role) {
        setRemoteParticipant({
          name: data.name,
          role: data.role,
        });
      }

      // We don't create an offer here.
      // The new participant is responsible
      // for creating the offer.
    }

    async function handleOffer(data: {
      offer: SignalDescription;
      senderSocketId: string;
    }) {
      try {
        remoteSocketIdRef.current = data.senderSocketId;

        const peer = createPeerConnection(data.senderSocketId);

        await peer.setRemoteDescription(new RTCSessionDescription(data.offer));

        for (const candidate of pendingIceCandidatesRef.current) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        }

        pendingIceCandidatesRef.current = [];

        const answer = await peer.createAnswer();

        await peer.setLocalDescription(answer);

        socket.emit("webrtc-answer", {
          targetSocketId: data.senderSocketId,

          answer: {
            type: answer.type,
            sdp: answer.sdp ?? "",
          } satisfies SignalDescription,
        });
      } catch (error) {
        console.error("Offer handling failed:", error);
      }
    }

    async function handleAnswer(data: { answer: SignalDescription }) {
      try {
        if (!peerRef.current) {
          return;
        }

        await peerRef.current.setRemoteDescription(
          new RTCSessionDescription(data.answer),
        );

        for (const candidate of pendingIceCandidatesRef.current) {
          await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }

        pendingIceCandidatesRef.current = [];
      } catch (error) {
        console.error("Answer handling failed:", error);
      }
    }

    async function handleIceCandidate(data: {
      candidate: RTCIceCandidateInit;
    }) {
      if (!peerRef.current) {
        pendingIceCandidatesRef.current.push(data.candidate);

        return;
      }

      try {
        const remoteDescription = peerRef.current.remoteDescription;

        if (!remoteDescription) {
          pendingIceCandidatesRef.current.push(data.candidate);

          return;
        }

        await peerRef.current.addIceCandidate(
          new RTCIceCandidate(data.candidate),
        );
      } catch (error) {
        console.error("ICE candidate error:", error);
      }
    }

    function handlePeerLeft() {
      setRemoteConnected(false);
      setRemoteParticipant(null);

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }

      peerRef.current?.close();

      peerRef.current = null;

      remoteSocketIdRef.current = null;
    }

    socket.on("connect", handleConnect);

    socket.on("disconnect", handleDisconnect);

    socket.on("room-participants", handleRoomParticipants);

    socket.on("ai:error", handleAIError);

    socket.on("interview:state", handleInterviewState);

    socket.on("ai:question", handleAIQuestion);

    socket.on("ai:stop", handleAIStop);

    socket.on("question:reset", handleQuestionReset);

    socket.on("transcript:update", handleTranscript);

    socket.on("transcript:interim", handleInterimTranscript);

    socket.on("existing-peer", handleExistingPeer);

    socket.on("peer-joined", handlePeerJoined);

    socket.on("webrtc-offer", handleOffer);

    socket.on("webrtc-answer", handleAnswer);

    socket.on("webrtc-ice-candidate", handleIceCandidate);

    socket.on("peer-left", handlePeerLeft);

    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.emit("leave-room", roomId);

      socket.off("connect", handleConnect);

      socket.off("disconnect", handleDisconnect);

      socket.off("room-participants", handleRoomParticipants);

      socket.off("ai:error", handleAIError);

      socket.off("interview:state", handleInterviewState);

      socket.off("ai:question", handleAIQuestion);

      socket.off("ai:stop", handleAIStop);

      socket.off("question:reset", handleQuestionReset);

      socket.off("transcript:update", handleTranscript);

      socket.off("transcript:interim", handleInterimTranscript);

      socket.off("existing-peer", handleExistingPeer);

      socket.off("peer-joined", handlePeerJoined);

      socket.off("webrtc-offer", handleOffer);

      socket.off("webrtc-answer", handleAnswer);

      socket.off("webrtc-ice-candidate", handleIceCandidate);

      socket.off("peer-left", handlePeerLeft);

      peerRef.current?.close();

      localStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });

      localStreamRef.current = null;
    };
  }, [roomId, userName, userRole]);

  // =====================================================
  // START MICROPHONE ONLY
  // =====================================================

  async function startMicrophone() {
    try {
      setError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Microphone is not available in this browser.");

        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      const audioTrack = stream.getAudioTracks()[0];

      if (!audioTrack) {
        return;
      }

      // Create our combined local stream
      // if it doesn't exist yet.
      if (!localStreamRef.current) {
        localStreamRef.current = new MediaStream();
      }

      // Prevent duplicate audio tracks.
      const existingAudio = localStreamRef.current.getAudioTracks();

      existingAudio.forEach((track) => {
        localStreamRef.current?.removeTrack(track);
        track.stop();
      });

      localStreamRef.current.addTrack(audioTrack);

      // Enable audio in the peer.
      if (peerRef.current) {
        addLocalTrackToPeer(audioTrack);

        await renegotiatePeer();
      }

      setMicOn(true);

      // If camera is currently off,
      // keep video preview hidden.
      if (localVideoRef.current && !cameraOn) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    } catch (error) {
      console.error("Microphone permission error:", error);

      setMicOn(false);

      setError("Microphone permission was denied.");
    }
  }

  // =====================================================
  // START CAMERA ONLY
  // =====================================================

  async function startCamera() {
    try {
      setError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera is not available in this browser.");

        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      const videoTrack = stream.getVideoTracks()[0];

      if (!videoTrack) {
        return;
      }

      if (!localStreamRef.current) {
        localStreamRef.current = new MediaStream();
      }

      // Prevent duplicate video tracks.
      const existingVideo = localStreamRef.current.getVideoTracks();

      existingVideo.forEach((track) => {
        localStreamRef.current?.removeTrack(track);
        track.stop();
      });

      localStreamRef.current.addTrack(videoTrack);

      // Show camera locally.
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }

      // Enable video in peer.
      if (peerRef.current) {
        addLocalTrackToPeer(videoTrack);

        await renegotiatePeer();
      }

      setCameraOn(true);
    } catch (error) {
      console.error("Camera permission error:", error);

      setCameraOn(false);

      setError("Camera permission was denied.");
    }
  }

  // =====================================================
  // TOGGLE MICROPHONE
  // =====================================================

  async function toggleMic() {
    if (!micOn) {
      await startMicrophone();
      return;
    }

    const audioTracks = localStreamRef.current?.getAudioTracks() ?? [];

    audioTracks.forEach((track) => {
      track.enabled = false;
    });

    setMicOn(false);
  }

  // =====================================================
  // TOGGLE CAMERA
  // =====================================================

  async function toggleCamera() {
    if (!cameraOn) {
      await startCamera();
      return;
    }

    const videoTracks = localStreamRef.current?.getVideoTracks() ?? [];

    videoTracks.forEach((track) => {
      track.enabled = false;
    });

    setCameraOn(false);
  }

  // =====================================================
  // SCREEN SHARE
  // =====================================================

  async function toggleScreenShare() {
    if (screenSharing) {
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0];

      if (cameraTrack && peerRef.current) {
        cameraTrack.enabled = cameraOn;

        const sender = peerRef.current
          .getSenders()
          .find((item) => item.track?.kind === "video");

        if (sender) {
          await sender.replaceTrack(cameraTrack);
        }
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }

      setScreenSharing(false);

      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });

      const screenTrack = screenStream.getVideoTracks()[0];

      if (!screenTrack) {
        return;
      }

      const sender = peerRef.current
        ?.getSenders()
        .find((item) => item.track?.kind === "video");

      if (sender) {
        await sender.replaceTrack(screenTrack);
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = screenStream;
      }

      setScreenSharing(true);

      screenTrack.onended = async () => {
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];

        if (cameraTrack && peerRef.current) {
          const sender = peerRef.current
            .getSenders()
            .find((item) => item.track?.kind === "video");

          if (sender) {
            await sender.replaceTrack(cameraTrack);
          }
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }

        setScreenSharing(false);
      };
    } catch (error) {
      console.error("Screen sharing failed:", error);
    }
  }
  // =====================================================
  // SPEECH TO TEXT
  // =====================================================

    // =====================================================
  // SPEECH TO TEXT AND LIVE TRANSCRIPTION
  // =====================================================

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";
    speechRecognitionRef.current = recognition;

    recognition.onstart = () => {
      setIsListening(true);
      setInterimText("");
      setError("");
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let temporaryText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const recognizedText = result[0].transcript.trim();

        if (result.isFinal && recognizedText) {
          finalText += recognizedText + " ";
        } else if (!result.isFinal) {
          temporaryText += recognizedText;
        }
      }

      const socket = socketRef.current;
      const cleanFinalText = finalText.trim();

      if (socket && temporaryText.trim()) {
        socket.emit("transcript:interim", {
          roomId,
          text: temporaryText.trim(),
        });
      } else if (socket && cleanFinalText) {
        socket.emit("transcript:interim", { roomId, text: "" });
      }

      if (cleanFinalText && socket) {
        socket.emit("transcript:segment", {
          roomId,
          text: cleanFinalText,
        });

        if (userRole === "CANDIDATE") {
          setAnswerText((previous) => {
            const separator = previous.trim().length > 0 ? " " : "";
            return previous + separator + cleanFinalText;
          });
        }
      }

      setInterimText(temporaryText);
    };

    recognition.onerror = (event) => {
      const speechEvent = event as Event & { error?: string };
      const errorType = speechEvent.error || "unknown";
      console.warn("Speech recognition error:", errorType);
      setIsListening(false);

      if (errorType === "not-allowed" || errorType === "service-not-allowed") {
        shouldKeepListeningRef.current = false;
        setSpeechSupported(false);
        setError("Microphone or speech recognition permission was denied. You can still type your answer.");
      } else if (errorType === "no-speech") {
        // Silence is normal in an interview; onend will restart recognition.
        setError("");
      } else {
        setError("Speech recognition stopped. You can restart it or type your answer.");
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText("");
      if (recognitionRestartTimerRef.current !== null) {
        window.clearTimeout(recognitionRestartTimerRef.current);
        recognitionRestartTimerRef.current = null;
      }

      // Chrome/Edge may end a continuous session after a silence or network
      // pause. Restart only while the user has explicitly enabled listening.
      if (shouldKeepListeningRef.current) {
        recognitionRestartTimerRef.current = window.setTimeout(() => {
          if (!shouldKeepListeningRef.current) return;
          try {
            recognition.start();
          } catch {
            // A browser may still be completing the previous recognition session.
          }
        }, 300);
      }
    };

    return () => {
      shouldKeepListeningRef.current = false;
      if (recognitionRestartTimerRef.current !== null) {
        window.clearTimeout(recognitionRestartTimerRef.current);
      }
      try {
        recognition.abort();
      } catch {
        // The recognition session may already have stopped.
      }
      speechRecognitionRef.current = null;
    };
  }, [roomId, userRole]);

  function toggleSpeechRecognition() {
    if (!speechSupported) {
      setError(
        "Speech recognition is not supported in this browser. You can type your answer instead.",
      );
      return;
    }

    const recognition = speechRecognitionRef.current;

    if (!recognition) {
      setError("Speech recognition could not be initialized.");
      return;
    }

    if (isListening || shouldKeepListeningRef.current) {
      shouldKeepListeningRef.current = false;
      if (recognitionRestartTimerRef.current !== null) {
        window.clearTimeout(recognitionRestartTimerRef.current);
        recognitionRestartTimerRef.current = null;
      }
      recognition.stop();
      return;
    }

    try {
      setError("");
      shouldKeepListeningRef.current = true;
      recognition.start();
    } catch (error) {
      console.error("Could not start speech recognition:", error);
      setError(
        "Could not start speech recognition. Stop any existing recognition session and try again.",
      );
    }
  }

  function submitCandidateAnswer() {
    const socket = socketRef.current;

    const answer = answerText.trim();

    if (!socket) {
      setError("Connection to the interview server is not available.");

      return;
    }

    if (!answer) {
      setError("Please speak or type an answer first.");

      return;
    }

    socket.emit("candidate:answer", {
      roomId,
      text: answer,
    });

    shouldKeepListeningRef.current = false;
    try {
      speechRecognitionRef.current?.stop();
    } catch {
      // Recognition may already have ended.
    }
    setIsListening(false);
    setAnswerText("");
    setInterimText("");
    setError("");
  }
  // =====================================================
  // AI CONTROL
  // =====================================================

  function sendAIControl(
    action:
      | "PAUSE"
      | "RESUME"
      | "NEXT_QUESTION"
      | "HUMAN_TAKEOVER"
      | "HUMAN_FINISHED"
      | "RESET_QUESTION"
      | "END_INTERVIEW",
  ) {
    // Clear locally on click so the question panel becomes blank immediately;
    // the server broadcasts the authoritative state to both participants.
    if (action === "RESET_QUESTION") {
      currentQuestionRef.current = null;
      setAnswerText("");
      setInterimText("");
      setInterimTranscript(null);
      setInterviewState((previous) => ({
        ...previous,
        currentQuestion: null,
        ...(previous.state === "AI_ANALYZING"
          ? { state: "AI_LISTENING", aiStatus: "LISTENING" as const }
          : {}),
      }));
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    }

    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Not connected to the interview server. Reconnect and try again.");
      return;
    }

    socket.emit("ai-control", {
      roomId,
      action,
    });
  }

  // =====================================================
  // LEAVE INTERVIEW
  // =====================================================

  function leaveInterview() {
    localStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });

    peerRef.current?.close();

    socketRef.current?.emit("leave-room", roomId);

    window.location.href = "/dashboard";
  }

  // =====================================================
  // PARTICIPANT INFORMATION
  // =====================================================

  const localInitials = getInitials(userName);

  const remoteName =
    remoteParticipant?.name ??
    (userRole === "CANDIDATE" ? "Interviewer" : "Candidate");

  const remoteInitials = getInitials(remoteName);

  // =====================================================
  // UI
  // =====================================================

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#070b14] text-white">
      {/* =================================================
          TOP BAR
      ================================================= */}

      <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-white/[0.08] bg-[#0d1422] px-5">
        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/15 text-blue-400">
            <Radio size={18} />
          </div>

          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-semibold tracking-tight">
                Human + AI Interview
              </h1>

              <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-400">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                Live
              </span>
            </div>

            <p className="mt-0.5 text-xs text-slate-500">
              Software Engineer Interview
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2 text-xs text-slate-400 sm:flex">
            <Users size={14} />

            <span>
              {participantCount} participant
              {participantCount !== 1 ? "s" : ""}
            </span>
          </div>

          <div
            className={`flex items-center gap-2 text-xs ${
              socketConnected ? "text-emerald-400" : "text-red-400"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                socketConnected ? "bg-emerald-400" : "bg-red-400"
              }`}
            />

            {socketConnected ? "Connected" : "Disconnected"}
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
            <Clock3 size={14} />
            <ElapsedTimer startedAt={interviewState.startedAt} />
          </div>
        </div>
      </header>

      {/* =================================================
          MAIN AREA
      ================================================= */}

      <div className="flex min-h-0 flex-1">
        {/* =================================================
            VIDEO AREA
        ================================================= */}

        <main className="relative min-w-0 flex-1 bg-[#050811] p-4">
          <div className="relative h-full overflow-hidden rounded-3xl border border-white/[0.08] bg-[#101827] shadow-2xl shadow-black/40">
            {/* REMOTE VIDEO */}

            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`absolute inset-0 h-full w-full object-cover ${
                remoteConnected ? "opacity-100" : "opacity-0"
              }`}
            />

            {/* REMOTE CAMERA OFF */}

            {!remoteConnected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#111927]">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-blue-600 text-2xl font-semibold shadow-xl shadow-blue-950/40">
                  {remoteInitials}
                </div>

                <h2 className="mt-5 text-base font-semibold">{remoteName}</h2>

                <p className="mt-1 text-xs text-slate-500">
                  {participantCount >= 2
                    ? "Camera is off"
                    : "Waiting for interviewer"}
                </p>
              </div>
            )}

            {/* REMOTE NAME */}

            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2 backdrop-blur-md">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold">
                {remoteInitials}
              </div>

              <div>
                <p className="text-xs font-medium">{remoteName}</p>

                <p className="text-[10px] text-slate-400">
                  {remoteParticipant?.role === "CANDIDATE"
                    ? "Candidate"
                    : "Interviewer"}
                </p>
              </div>
            </div>

            {/* =================================================
                LOCAL VIDEO
            ================================================= */}

            <div className="absolute bottom-4 right-4 h-36 w-52 overflow-hidden rounded-2xl border border-white/15 bg-[#182231] shadow-2xl sm:h-40 sm:w-60">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className={`h-full w-full object-cover ${
                  cameraOn && !screenSharing
                    ? "opacity-100"
                    : screenSharing
                      ? "opacity-100"
                      : "opacity-0"
                }`}
              />

              {!cameraOn && !screenSharing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#182231]">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-base font-semibold">
                    {localInitials}
                  </div>

                  <p className="mt-2 text-xs font-medium">{userName}</p>

                  <p className="mt-0.5 text-[10px] text-slate-500">
                    Camera is off
                  </p>
                </div>
              )}

              <div className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-1 text-[10px] font-medium backdrop-blur">
                You
              </div>

              {!micOn && (
                <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-500/90">
                  <MicOff size={13} />
                </div>
              )}
            </div>

            {/* ERROR */}

            {error && (
              <div className="absolute left-4 top-4 max-w-md rounded-xl border border-amber-500/20 bg-amber-950/80 px-4 py-3 text-xs text-amber-200 backdrop-blur-md">
                {error}
              </div>
            )}
          </div>
        </main>

        {/* =================================================
            AI PANEL
        ================================================= */}

        <aside className="flex h-full min-h-0 w-[380px] shrink-0 flex-col overflow-y-auto overscroll-contain border-l border-white/[0.08] bg-[#0b1120]">
          {/* AI HEADER */}

          <div className="border-b border-white/[0.08] bg-[#0e1627] p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 text-blue-400 ring-1 ring-blue-400/20">
                  <Sparkles size={20} />

                  <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[#0d1422] bg-emerald-400" />
                </div>

                <div>
                  <p className="text-sm font-semibold">AI Interviewer</p>

                  <p className="mt-0.5 text-xs text-emerald-400">
                    {getAIStatusLabel(interviewState.aiStatus)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-slate-500">
                {interviewState.currentQuestion ? `Q${interviewState.questionNumber || 1}` : "—"}
              </div>
              {isInterviewer && (
                <button
                  type="button"
                  onClick={enableAIVoice}
                  disabled={aiVoiceEnabled}
                  className="mt-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:cursor-default disabled:opacity-60"
                >
                  {aiVoiceEnabled ? "AI Voice Enabled" : "Enable AI Voice"}
                </button>
              )}
            </div>
          </div>

          {/* AI STATUS */}

          <div className="border-b border-white/[0.08] p-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
              AI status
            </p>

            <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.035] p-3.5">
              {interviewState.aiStatus === "THINKING" ? (
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400" />
                </div>
              ) : (
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    interviewState.aiStatus === "PAUSED"
                      ? "bg-amber-400"
                      : interviewState.aiStatus === "SPEAKING"
                        ? "bg-blue-400"
                        : interviewState.aiStatus === "LISTENING"
                          ? "bg-emerald-400"
                          : "bg-slate-500"
                  }`}
                />
              )}

              <span className="text-xs text-slate-200">
                {getAIStatusLabel(interviewState.aiStatus)}
              </span>
            </div>
          </div>

          {/* CURRENT QUESTION */}

          <div className="border-b border-white/[0.08] p-5">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
              Current question
            </p>

            <div className="rounded-2xl border border-blue-400/20 bg-gradient-to-br from-blue-500/[0.10] to-violet-500/[0.05] p-5 shadow-lg shadow-blue-950/10">
              <p className="text-[15px] font-medium leading-7 text-slate-100">
                {interviewState.currentQuestion ?? "\u00a0"}
              </p>
            </div>
          </div>

          {/* CANDIDATE ANSWER */}

          {userRole === "CANDIDATE" && (
            <div className="border-b border-white/[0.08] p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                  Your answer
                </p>

                {isListening && (
                  <span className="flex items-center gap-1.5 text-[10px] font-medium text-red-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
                    Listening
                  </span>
                )}
              </div>

              <textarea
                value={answerText}
                onChange={(event) => setAnswerText(event.target.value)}
                placeholder={
                  isListening
                    ? "Speak your answer..."
                    : "Type your answer or use the microphone..."
                }
                rows={4}
                className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.04] p-3 text-xs leading-5 text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-blue-500/40 focus:bg-white/[0.06]"
              />

              {interimText && (
                <div className="mt-2 rounded-lg bg-blue-500/[0.06] px-3 py-2 text-[11px] leading-5 text-blue-300">
                  {interimText}
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={toggleSpeechRecognition}
                  className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium transition ${
                    isListening
                      ? "bg-red-500/15 text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/20"
                      : "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20 hover:bg-blue-500/20"
                  }`}
                >
                  {isListening ? "Stop Listening" : "🎤 Speak"}
                </button>

                <button
                  type="button"
                  onClick={submitCandidateAnswer}
                  disabled={!answerText.trim()}
                  className="rounded-xl bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Submit Answer
                </button>
              </div>

              {!speechSupported && (
                <p className="mt-2 text-[10px] leading-4 text-slate-500">
                  Speech recognition is unavailable in this browser. You can
                  still type your answer.
                </p>
              )}
            </div>
          )}

          {/* TRANSCRIPT */}

          <div className="max-h-52 shrink-0 overflow-y-auto p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                Live transcript
              </p>

              <span className="text-[10px] text-slate-600">Live</span>
            </div>

            {transcript.length === 0 && !interimTranscript ? (
              <div className="rounded-xl border border-dashed border-white/[0.08] p-4 text-center">
                <p className="text-xs text-slate-600">
                  Start live transcription to see speech from both participants.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {transcript.map((item, index) => (
                  <div
                    key={`${item.timestamp}-${index}`}
                    className="rounded-xl bg-white/[0.035] p-3"
                  >
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                      {item.speaker}
                    </p>
                    <p className="text-xs leading-5 text-slate-300">{item.text}</p>
                  </div>
                ))}
                {interimTranscript && (
                  <div className="rounded-xl border border-blue-400/20 bg-blue-500/[0.06] p-3">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
                      {interimTranscript.speaker} · listening
                    </p>
                    <p className="text-xs leading-5 text-slate-200">{interimTranscript.text}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* HUMAN INTERVIEWER CONTROLS */}

          {isInterviewer && (
            <div className="shrink-0 border-t border-white/[0.08] bg-[#0b1120] p-4">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
                Interview controls
              </p>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={toggleSpeechRecognition}
                  disabled={!speechSupported || interviewState.state === "COMPLETED"}
                  title="Transcribe the interviewer's speech into the shared live transcript"
                  className="col-span-2 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2.5 text-xs text-violet-200 transition hover:bg-violet-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isListening ? "Stop live transcript" : "Start live transcript"}
                </button>

                {/* START INTERVIEW */}
                <button
                  type="button"
                  onClick={() => {
                    socketRef.current?.emit("interview:start", roomId);
                  }}
                  disabled={interviewState.state !== "WAITING"}
                  className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-3 py-3 text-xs font-semibold text-white shadow-lg shadow-emerald-950/30 transition hover:from-emerald-500 hover:to-emerald-400"
                >
                  <Sparkles size={14} />
                  Start AI Interview
                </button>

                {/* HUMAN TAKEOVER: pauses AI and starts the human interviewer's turn */}
                <button
                  type="button"
                  onClick={() => sendAIControl("HUMAN_TAKEOVER")}
                  disabled={interviewState.state === "WAITING" || interviewState.state === "COMPLETED" || interviewState.state === "HUMAN_TURN"}
                  title="Pause the AI and ask your own questions"
                  className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2.5 text-xs text-blue-300 transition hover:bg-blue-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Start human turn
                </button>

                {/* FINISH TURN: hand control back to AI */}
                <button
                  type="button"
                  onClick={() => sendAIControl("HUMAN_FINISHED")}
                  disabled={interviewState.state !== "HUMAN_TURN" && interviewState.state !== "PAUSED_BY_HUMAN"}
                  title="Finish your turn and return control to the AI"
                  className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-xs text-slate-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Return to AI
                </button>

                {/* RESET ACTIVE QUESTION */}
                <button
                  type="button"
                  onClick={() => sendAIControl("RESET_QUESTION")}
                  disabled={!interviewState.currentQuestion || interviewState.state === "COMPLETED"}
                  title="Clear the active question without deleting interview history"
                  className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200 transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Reset question
                </button>

                {/* NEXT QUESTION */}
                <button
                  type="button"
                  onClick={() => sendAIControl("NEXT_QUESTION")}
                  disabled={interviewState.state === "WAITING" || interviewState.state === "COMPLETED" || interviewState.state === "AI_ANALYZING" || interviewState.state === "HUMAN_TURN" || interviewState.state === "PAUSED_BY_HUMAN" || interviewState.aiPausedByHuman}
                  className="rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next question
                </button>

                {/* END INTERVIEW */}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("End this interview? The current session will be marked completed.")) {
                      sendAIControl("END_INTERVIEW");
                    }
                  }}
                  disabled={interviewState.state === "WAITING" || interviewState.state === "COMPLETED"}
                  className="col-span-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs font-medium text-red-200 transition hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  End interview
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* =================================================
          BOTTOM CONTROLS
      ================================================= */}

      <footer className="flex h-[88px] shrink-0 items-center justify-center border-t border-white/[0.08] bg-[#080d18]/95 px-4 backdrop-blur-xl">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* MICROPHONE */}

          <button
            type="button"
            onClick={toggleMic}
            title={micOn ? "Mute microphone" : "Turn microphone on"}
            className={`flex h-12 w-12 items-center justify-center rounded-full border transition ${
              micOn
                ? "border-white/10 bg-white/[0.06] hover:bg-white/[0.1]"
                : "border-red-500/30 bg-red-500/15 text-red-300 hover:bg-red-500/20"
            }`}
          >
            {micOn ? <Mic size={19} /> : <MicOff size={19} />}
          </button>

          {/* CAMERA */}

          <button
            type="button"
            onClick={toggleCamera}
            title={cameraOn ? "Turn camera off" : "Turn camera on"}
            className={`flex h-12 w-12 items-center justify-center rounded-full border transition ${
              cameraOn
                ? "border-white/10 bg-white/[0.06] hover:bg-white/[0.1]"
                : "border-red-500/30 bg-red-500/15 text-red-300 hover:bg-red-500/20"
            }`}
          >
            {cameraOn ? <Camera size={19} /> : <CameraOff size={19} />}
          </button>

          {/* SCREEN SHARE */}

          <button
            type="button"
            onClick={toggleScreenShare}
            title="Share screen"
            className={`hidden h-12 w-12 items-center justify-center rounded-full border transition sm:flex ${
              screenSharing
                ? "border-blue-500/30 bg-blue-500/15 text-blue-300"
                : "border-white/10 bg-white/[0.06] hover:bg-white/[0.1]"
            }`}
          >
            <MonitorUp size={19} />
          </button>

          {/* MORE */}

          <div className="relative hidden sm:block">
            <button
              type="button"
              title="More options"
              aria-expanded={showMoreOptions}
              onClick={() => setShowMoreOptions((open) => !open)}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] transition hover:bg-white/[0.1]"
            >
              <MoreHorizontal size={20} />
            </button>
            {showMoreOptions && (
              <div className="absolute bottom-14 right-0 z-50 w-48 rounded-xl border border-white/10 bg-[#111a2b] p-2 shadow-2xl">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(roomId);
                      setError("Room ID copied to clipboard.");
                    } catch {
                      setError(`Room ID: ${roomId}`);
                    }
                    setShowMoreOptions(false);
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left text-xs text-slate-200 hover:bg-white/[0.08]"
                >
                  Copy room ID
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreOptions(false);
                    leaveInterview();
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10"
                >
                  Leave interview
                </button>
              </div>
            )}
          </div>

          <div className="mx-2 hidden h-8 w-px bg-white/10 sm:block" />

          {/* LEAVE */}

          <button
            type="button"
            onClick={leaveInterview}
            title="Leave interview"
            className="flex h-12 items-center gap-2 rounded-full bg-red-600 px-5 text-xs font-semibold text-white transition hover:bg-red-500"
          >
            <PhoneOff size={16} />

            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
