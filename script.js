import * as webcomponents from 'https://unpkg.com/@webcomponents/custom-elements@1.4.2/custom-elements.min.js';

class VoiceAssistant {
  constructor() {
    this.recognition = null;
    this.synthesis = window.speechSynthesis;
    this.isListening = false;
    this.conversationHistory = [];
    this.lastInteractionTime = null;
    this.expectingFollowUp = false;
    
    // Credit system
    this.credits = {
      amount: 150,
      costs: {
        text: 1,
        internet: 5,
        file: 10,
        camera: 15
      },
      maxAmount: 150,
      rechargeTime: 60 * 60 * 1000, // 1 hour in milliseconds
      lastDepletedTime: null
    };
    
    this.watercolorBg = document.querySelector('.watercolor-bg');
    this.speechText = document.createElement('div');
    this.speechText.className = 'speech-text';
    document.querySelector('.container').appendChild(this.speechText);
    
    // Set initial state
    this.setVisualState('idle');
    
    this.settings = {
      aiName: '',
      userName: '',
      occupation: '',
      aiTraits: '',
      additionalInfo: ''
    };
    
    // Initialize websocket for global sync
    this.initWebsimSocket();
    
    this.loadSettings();
    this.setupStoreUI();
    this.checkForAssistantInURL();
    
    this.isMuted = false;
    
    // Load mute state from localStorage
    const savedMuteState = localStorage.getItem('voiceAssistantMuted');
    if (savedMuteState !== null) {
      this.isMuted = JSON.parse(savedMuteState);
      if (this.isMuted) {
        document.querySelector('.fa-volume-up').classList.replace('fa-volume-up', 'fa-volume-mute');
      }
    }
    
    this.cameraStream = null;
    this.cameraFacingMode = 'user'; // Default to user-facing camera
    this.cameraPreviewContainer = null; // Define it here
    this.cameraPreview = null; // Define it here
    this.liveCameraInterval = null; // Interval ID for live analysis
    this.lastSpokenText = null;

    this.setupUI();
    this.setupSettingsUI();
    this.initSpeechRecognition();
    this.startCreditTimer();
  }
  
  // ... existing code ...
  
  loadCredits() {
    const savedCredits = localStorage.getItem('voiceAssistantCredits');
    if (savedCredits) {
      const parsedCredits = JSON.parse(savedCredits);
      this.credits.amount = parsedCredits.amount;
      this.credits.lastDepletedTime = parsedCredits.lastDepletedTime ? new Date(parsedCredits.lastDepletedTime) : null;
      
      // Check if we need to recharge credits
      if (this.credits.lastDepletedTime && this.credits.amount < this.credits.maxAmount) {
        const now = new Date();
        const timeSinceDepletionMs = now - new Date(this.credits.lastDepletedTime);
        
        if (timeSinceDepletionMs >= this.credits.rechargeTime) {
          // If enough time has passed, fully recharge
          this.credits.amount = this.credits.maxAmount;
          this.credits.lastDepletedTime = null;
          this.saveCredits();
        }
      }
    } else {
      // If no credits saved, initialize with default amount (150)
      this.credits.amount = this.credits.maxAmount;
      this.saveCredits();
    }
    
    this.updateCreditsDisplay();
  }
  
  saveCredits() {
    localStorage.setItem('voiceAssistantCredits', JSON.stringify({
      amount: this.credits.amount,
      lastDepletedTime: this.credits.lastDepletedTime
    }));
  }
  
  updateCreditsDisplay() {
    const creditsAmountEl = document.querySelector('.credits-amount');
    const creditsTimerEl = document.querySelector('.credits-timer');
    
    creditsAmountEl.textContent = this.credits.amount;
    
    if (this.credits.amount <= 0 && this.credits.lastDepletedTime) {
      const now = new Date();
      const timeSinceDepletionMs = now - new Date(this.credits.lastDepletedTime);
      const timeRemainingMs = Math.max(0, this.credits.rechargeTime - timeSinceDepletionMs);
      
      if (timeRemainingMs > 0) {
        const minutesRemaining = Math.ceil(timeRemainingMs / (60 * 1000));
        creditsTimerEl.textContent = `(${minutesRemaining} min)`;
      } else {
        creditsTimerEl.textContent = '';
      }
    } else {
      creditsTimerEl.textContent = '';
    }
  }
  
  startCreditTimer() {
    // Update the timer display every minute
    setInterval(() => {
      if (this.credits.amount <= 0 && this.credits.lastDepletedTime) {
        const now = new Date();
        const timeSinceDepletionMs = now - new Date(this.credits.lastDepletedTime);
        
        if (timeSinceDepletionMs >= this.credits.rechargeTime) {
          // Time's up, recharge credits
          this.credits.amount = this.credits.maxAmount;
          this.credits.lastDepletedTime = null;
          this.saveCredits();
          this.speak("Deine Credits wurden wieder aufgeladen.");
        }
        
        this.updateCreditsDisplay();
      }
    }, 60000); // Check every minute
  }
  
  useCredits(type) {
    const cost = this.credits.costs[type];
    
    if (this.credits.amount < cost) {
      const now = new Date();
      
      if (!this.credits.lastDepletedTime) {
        this.credits.lastDepletedTime = now;
        this.saveCredits();
      }
      
      const timeSinceDepletionMs = now - new Date(this.credits.lastDepletedTime);
      const timeRemainingMs = Math.max(0, this.credits.rechargeTime - timeSinceDepletionMs);
      const minutesRemaining = Math.ceil(timeRemainingMs / (60 * 1000));
      
      return {
        success: false,
        message: `Nicht genügend Credits für diese Aktion. Warte bitte ${minutesRemaining} Minuten auf neue Credits.`
      };
    }
    
    this.credits.amount -= cost;
    this.saveCredits();
    this.updateCreditsDisplay();
    
    return {
      success: true
    };
  }
  
  setupUI() {
    this.startButton = document.getElementById('startButton');
    this.startButton.addEventListener('click', () => this.toggleListening());
    
    // Add info button handler
    const infoButton = document.querySelector('.fa-info-circle').parentElement;
    const infoOverlay = document.querySelector('.info-overlay');
    const closeInfoButton = document.querySelector('.close-info');
    
    infoButton.addEventListener('click', () => {
      this.updateInfoContent();
      infoOverlay.style.display = 'flex';
    });
    
    closeInfoButton.addEventListener('click', () => {
      infoOverlay.style.display = 'none';
    });
    
    // Add volume button handler
    const volumeButton = document.querySelector('.fa-volume-up').parentElement;
    volumeButton.addEventListener('click', () => {
      this.toggleMute();
    });
    
    // Add store button handler
    const storeButton = document.querySelector('.store-button');
    storeButton.addEventListener('click', () => {
      this.openStore();
    });

    // Initialize camera preview elements
    this.cameraPreviewContainer = document.getElementById('camera-preview-container');
    this.cameraPreview = document.getElementById('camera-preview');
  }
  
  setupSettingsUI() {
    const settingsButton = document.querySelector('.fa-cog').parentElement;
    const settingsOverlay = document.querySelector('.settings-overlay');
    const closeButton = document.querySelector('.close-settings');
    const saveButton = document.querySelector('.save-button');
    const resetButton = document.querySelector('.reset-button');
    const confirmationDialog = document.querySelector('.confirmation-dialog');
    const confirmYes = document.querySelector('.confirm-yes');
    const confirmNo = document.querySelector('.confirm-no');
    
    settingsButton.addEventListener('click', () => {
      settingsOverlay.style.display = 'flex';
      this.populateSettingsForm();
    });

    closeButton.addEventListener('click', () => {
      if (this.hasUnsavedChanges()) {
        confirmationDialog.style.display = 'block';
      } else {
        settingsOverlay.style.display = 'none';
      }
    });

    saveButton.addEventListener('click', () => {
      this.saveSettings();
      settingsOverlay.style.display = 'none';
    });

    resetButton.addEventListener('click', () => {
      this.resetSettings();
      this.populateSettingsForm();
    });

    confirmYes.addEventListener('click', () => {
      this.resetSettings();
      confirmationDialog.style.display = 'none';
      settingsOverlay.style.display = 'none';
    });

    confirmNo.addEventListener('click', () => {
      confirmationDialog.style.display = 'none';
    });
  }

  hasUnsavedChanges() {
    const form = document.querySelector('.settings-form');
    return this.settings.aiName !== form.querySelector('#aiName').value ||
           this.settings.userName !== form.querySelector('#userName').value ||
           this.settings.occupation !== form.querySelector('#occupation').value ||
           this.settings.aiTraits !== form.querySelector('#aiTraits').value ||
           this.settings.additionalInfo !== form.querySelector('#additionalInfo').value;
  }

  populateSettingsForm() {
    const form = document.querySelector('.settings-form');
    form.querySelector('#aiName').value = this.settings.aiName;
    form.querySelector('#userName').value = this.settings.userName;
    form.querySelector('#occupation').value = this.settings.occupation;
    form.querySelector('#aiTraits').value = this.settings.aiTraits;
    form.querySelector('#additionalInfo').value = this.settings.additionalInfo;

    // Disable settings if using a custom assistant
    const assistantId = new URLSearchParams(window.location.search).get('assistant');
    if (assistantId && assistantId !== 'standard') {
      this.disableSettingsForm(form);
    } else {
      this.enableSettingsForm(form);
    }

    if (!assistantId) {
        this.enableSettingsForm(form);
    }
  }

  saveSettings() {
    const form = document.querySelector('.settings-form');
    this.settings = {
      aiName: form.querySelector('#aiName').value,
      userName: form.querySelector('#userName').value,
      occupation: form.querySelector('#occupation').value,
      aiTraits: form.querySelector('#aiTraits').value,
      additionalInfo: form.querySelector('#additionalInfo').value
    };
    localStorage.setItem('voiceAssistantSettings', JSON.stringify(this.settings));
    // Persist the selected assistant ID to localStorage if one is active
    const assistantId = new URLSearchParams(window.location.search).get('assistant');
    if (assistantId) {
        localStorage.setItem('lastUsedAssistantId', assistantId);
    }
  }

  resetSettings() {
    this.settings = {
      aiName: '',
      userName: '',
      occupation: '',
      aiTraits: '',
      additionalInfo: ''
    };
    localStorage.setItem('voiceAssistantSettings', JSON.stringify(this.settings));
    localStorage.removeItem('lastUsedAssistantId'); // Remove the last used assistant ID on reset
  }
  
  loadSettings() {
    const savedSettings = localStorage.getItem('voiceAssistantSettings');
    if (savedSettings) {
      this.settings = JSON.parse(savedSettings);
    }
    // Check and load if a previous assistant was in use
    const lastUsedAssistantId = localStorage.getItem('lastUsedAssistantId');
    if (lastUsedAssistantId) {
        // Load the assistant
        const assistants = this.loadAssistantsFromCloud();
        const assistant = assistants.find(a => a.id === lastUsedAssistantId);

        if (assistant) {
            // Update settings
            this.settings.aiName = assistant.name;
            this.settings.aiTraits = assistant.traits;
            this.settings.additionalInfo = assistant.info;

            // Update credits
            this.credits.maxAmount = assistant.credits;
            this.credits.amount = assistant.credits;

            // Save settings
            localStorage.setItem('voiceAssistantSettings', JSON.stringify(this.settings));
            this.saveCredits();

            // Update UI
            this.updateCreditsDisplay();

            // Add to URL without reloading page
            const url = new URL(window.location);
            url.searchParams.set('assistant', lastUsedAssistantId);
            window.history.pushState({}, '', url);
        } else {
            // If assistant not found, remove the stored ID to avoid future attempts
            this.settings.aiName = '';
            this.settings.aiTraits = '';
            this.settings.additionalInfo = '';
            this.saveSettings();
            localStorage.removeItem('lastUsedAssistantId');
        }
    }
  }
  
  toggleListening() {
    if (this.isListening) {
      this.stopListening();
    } else {
      this.startListening();
    }
  }

  startListening() {
    if (this.recognition && !this.isListening) {
      try {
        this.isListening = true;
        this.recognition.start();
        this.startButton.classList.add('listening');
        this.setVisualState('user-speaking');
      } catch (error) {
        console.error('Error starting recognition:', error);
        // Reset state if start fails
        this.isListening = false;
        this.startButton.classList.remove('listening');
        this.setVisualState('idle');
      }
    }
  }

  stopListening() {
    if (this.recognition) {
      this.isListening = false;
      this.recognition.stop();
      this.startButton.classList.remove('listening');
      this.setVisualState('idle');
      // Hide speech text
      this.speechText.classList.remove('visible');
      this.speechText.textContent = '';
    }
  }

  setVisualState(state) {
    this.watercolorBg.classList.remove('idle', 'user-speaking', 'ai-speaking');
    switch(state) {
      case 'idle':
        this.watercolorBg.classList.add('idle');
        break;
      case 'user-speaking':
        this.watercolorBg.classList.add('user-speaking');
        break;
      case 'ai-speaking':
        this.watercolorBg.classList.add('ai-speaking');
        break;
    }
  }

  speak(text) {
    this.synthesis.cancel();
    this.setVisualState('ai-speaking');

    // Only speak if not muted
    if (!this.isMuted) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'de-DE';
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      utterance.onend = () => {
        this.setVisualState('idle');
        if (this.expectingFollowUp) {
          setTimeout(() => {
            this.startListening();
          }, 500);
        } else {
          this.stopListening();
        }
      };

      this.synthesis.speak(utterance);
    } else {
      // If muted, just wait a moment and then continue with the flow
      setTimeout(() => {
        this.setVisualState('idle');
        if (this.expectingFollowUp) {
          setTimeout(() => {
            this.startListening();
          }, 500);
        } else {
          this.stopListening();
        }
      }, 1000);
    }
  }

  async handleSpeechResult(event) {
    const speechText = event.results[0][0].transcript.toLowerCase();
    
    this.lastInteractionTime = Date.now();
    this.lastSpokenText = speechText; // Store the last spoken text here for camera analysis

    // Add explicit chat history save command detection
    if (speechText.includes('speicher') && 
        (speechText.includes('chat') || speechText.includes('verlauf') || 
         speechText.includes('konversation') || speechText.includes('gespräch'))) {
      const result = this.useCredits('file');
      if (!result.success) {
        this.speak(result.message);
        return;
      }
      this.saveChatHistory();
      return;
    }

    // Check for camera activation request
    if (speechText.includes('kamera aktivieren')) {
        const result = this.useCredits('camera');
        if (!result.success) {
          this.speak(result.message);
          return;
        }
        this.handleCameraAccessRequest();
        return;
    }

    // Enhanced file creation detection - look for more complete commands
    if (speechText.includes('erstelle') || speechText.includes('speichere')) {
      let fileType = null;
      let content = null;
      
      // Extract content after keywords like "mit" or "über" or "namens"
      const contentMarkers = ['mit', 'über', 'namens', 'enthält', 'bestehend aus'];
      for (const marker of contentMarkers) {
        if (speechText.includes(marker)) {
          const parts = speechText.split(marker);
          if (parts.length > 1) {
            content = parts[1].trim();
            break;
          }
        }
      }

      if (speechText.includes('textdatei') || speechText.includes('text datei')) {
        fileType = 'text';
      } else if (speechText.includes('word') || speechText.includes('dokument')) {
        fileType = 'word';
      } else if (speechText.includes('excel') || speechText.includes('tabelle')) {
        fileType = 'excel';
      } else if (speechText.includes('powerpoint') || speechText.includes('präsentation')) {
        fileType = 'powerpoint';
      } else if (speechText.includes('chat') || speechText.includes('verlauf')) {
        this.saveChatHistory();
        return;
      }

      if (fileType && content) {
        // Check credits before file creation
        const result = this.useCredits('file');
        if (!result.success) {
          this.speak(result.message);
          return;
        }
        // Direct file creation with content
        await this.createFile(fileType, content);
        return;
      } else if (fileType) {
        // Check credits before asking for content
        const result = this.useCredits('file');
        if (!result.success) {
          this.speak(result.message);
          return;
        }
        // Fallback to asking for content if not provided
        await this.handleFileCreation(fileType);
        return;
      }
    }

    // Webseiten öffnen
    if (speechText.startsWith('öffne ') || speechText.startsWith('starte ')) {
      const websiteName = speechText.substring(speechText.indexOf(' ') + 1).trim();
      if (websiteName) {
        // Use regular text credits for opening websites
        const result = this.useCredits('text');
        if (!result.success) {
          this.speak(result.message);
          return;
        }
        this.openWebsite(websiteName);
      } else {
        this.speak('Bitte gib den Namen der Webseite an, die du öffnen möchtest.');
      }
      return;
    }

    // Check for camera/screen access request
    if (speechText.includes('kamera') || speechText.includes('bildschirm')) {
        if (speechText.includes('fragen') || speechText.includes('antworten') || speechText.includes('spiegelung') || speechText.includes('siehst du')) {
            const result = this.useCredits('camera');
            if (!result.success) {
              this.speak(result.message);
              return;
            }
            this.handleMediaAnalysisRequest(speechText);
            return;
        }
    }

    // Check if the query requires internet access
    if (this.requiresInternetAccess(speechText)) {
      const result = this.useCredits('internet');
      if (!result.success) {
        this.speak(result.message);
        return;
      }
      await this.handleInternetQuery(speechText);
      return;
    }

    // Normal conversation handling - use regular text credits
    const result = this.useCredits('text');
    if (!result.success) {
      this.speak(result.message);
      return;
    }

    // Normal conversation handling continues...
    const newMessage = {
      role: "user",
      content: speechText
    };
    this.conversationHistory.push(newMessage);
    this.conversationHistory = this.conversationHistory.slice(-10);

    try {
      let systemMessage = `Du bist ein hilfreicher Assistent${this.settings.aiName ? ` namens ${this.settings.aiName}` : ''}.
${this.settings.userName ? `Der Benutzer heißt ${this.settings.userName}.` : ''}
${this.settings.occupation ? `Beruf/Hobbys des Benutzers: ${this.settings.occupation}` : ''}
${this.settings.aiTraits ? `Deine Persönlichkeit ist: ${this.settings.aiTraits}` : ''}
${this.settings.additionalInfo ? `Zusätzliche Informationen: ${this.settings.additionalInfo}` : ''}

Antworte kurz und präzise auf Deutsch.
Wenn deine Antwort eine der folgenden Kriterien erfüllt, füge '[[FOLLOWUP]]' am Ende deiner Antwort hinzu:
- Deine Antwort endet mit einer Gegenfrage
- Du bittest um weitere Details oder Präzisierung
- Der Kontext erfordert eindeutig eine Fortsetzung der Konversation
- Du fragst nach einer Bestätigung oder weiteren Anweisungen
Füge KEIN [[FOLLOWUP]] hinzu, wenn:
- Deine Antwort abschließend und vollständig ist
- Der Benutzer einfach nur für eine Information gedankt hat
- Es sich um eine einfache Ja/Nein Antwort handelt
- Die Anfrage vollständig bearbeitet wurde`;

      // Check if camera is active and adapt the system message
      if (this.cameraPreviewContainer && this.cameraPreviewContainer.style.display === 'block') {
          systemMessage += `\n\nDie Kamera ist aktiviert. Wenn der Benutzer fragt, was du siehst oder wie etwas gemacht wird, beziehe dich auf das Kamerabild, falls relevant.`;
      }

      const completion = await websim.chat.completions.create({
        messages: [
          {
            role: "system",
            content: systemMessage
          },
          ...this.conversationHistory
        ]
      });

      const response = completion.content;
      this.conversationHistory.push(completion);
      
      this.expectingFollowUp = response.includes('[[FOLLOWUP]]');
      const cleanResponse = response.replace('[[FOLLOWUP]]', '').trim();
      
      this.speak(cleanResponse);
      
    } catch (error) {
      console.error('Fehler bei der AI-Antwort:', error);
      this.speak('Entschuldigung, es gab einen Fehler bei der Verarbeitung deiner Anfrage.');
    }
  }
  
  // ... existing code ...
  
  async handleCameraAccessRequest() {
    // Credits are already checked before this function is called
    this.speak("Bitte warte, während ich auf deine Kamera zugreife.");
    await this.startCamera();
    
    // Automatically analyze and describe what the camera sees
    try {
      const videoTrack = this.cameraStream.getVideoTracks()[0];
      const imageCapture = new ImageCapture(videoTrack);
      const bitmap = await imageCapture.grabFrame();

      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
      const imageDataUrl = canvas.toDataURL('image/jpeg');

      const completion = await websim.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `Du bist ein Assistent, der Bilder analysieren kann. Beschreibe kurz und präzise, was du auf dem Kamerabild siehst.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Beschreibe kurz, was du auf dem Kamerabild siehst.`,
              },
              {
                type: "image_url",
                image_url: { url: imageDataUrl },
              },
            ],
          },
        ],
      });

      const response = completion.content;
      this.speak(response + " Um weitere Fragen zum Kamerabild zu stellen, sage spezifische Fragen dazu.");
    } catch (error) {
      console.error("Fehler bei der initialen Kameraanalyse:", error);
    }
  }
  
  // ... existing code ...
  
  initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window) {
      this.recognition = new webkitSpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'de-DE';

      this.recognition.onstart = () => {
        this.setVisualState('user-speaking');
      };
      
      this.recognition.onresult = (event) => this.handleSpeechResult(event);
      this.recognition.onend = () => this.handleSpeechEnd();
      this.recognition.onerror = (event) => this.handleSpeechError(event);
    } else {
      console.error('Speech Recognition nicht unterstützt');
    }
  }

  async startCamera() {
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.cameraFacingMode },
      });

      this.cameraPreview.srcObject = this.cameraStream;
      this.cameraPreviewContainer.style.display = 'block'; // Make sure the container is visible
      this.cameraPreviewContainer.classList.add('camera-active');
      
      // Start live camera analysis
      this.startLiveCameraAnalysis();
      
      return true; // Return success for the auto-analysis function

    } catch (error) {
      let errorMessage = `Entschuldigung, es gab einen Fehler beim Zugriff auf die Kamera.`;
      if (error.message.includes('Permission denied')) {
        errorMessage += ' Bitte stelle sicher, dass die Berechtigungen erteilt wurden.';
      } else if (error.message.includes('Only one camera allowed.')) {
        errorMessage += ' Es ist nur eine Kamera gleichzeitig erlaubt.';
      } else if (error.message.includes('Could not start video source')) {
        errorMessage += ' Die Kamera konnte nicht gestartet werden. Stelle sicher, dass keine andere Anwendung die Kamera verwendet.';
      }
      else {
        errorMessage += ' Unbekannter Fehler: ' + error.message;
      }
      console.error("Fehler beim Zugriff auf die Kamera:", error);
      this.speak(errorMessage);
      return false;
    }
  }

  stopCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(track => track.stop());
      this.cameraStream = null;
      this.cameraPreview.srcObject = null;
      this.cameraPreviewContainer.classList.remove('camera-active');
      this.speak("Kamera deaktiviert.");

      // Stop live analysis
      this.stopLiveCameraAnalysis();

    } else {
      this.speak("Die Kamera ist nicht aktiv.");
    }
  }

  async switchCamera() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(track => track.stop());
      this.cameraStream = null;
      this.stopLiveCameraAnalysis();
    }

    this.cameraFacingMode = this.cameraFacingMode === 'user' ? 'environment' : 'user';

    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.cameraFacingMode },
      });

      this.cameraPreview.srcObject = this.cameraStream;
      this.startLiveCameraAnalysis();
      this.speak("Kamera gewechselt.");
    } catch (error) {
      let errorMessage = `Entschuldigung, es gab einen Fehler beim Wechseln der Kamera.`;
      if (error.message.includes('Permission denied')) {
        errorMessage += ' Bitte stelle sicher, dass die Berechtigungen erteilt wurden.';
      } else {
        errorMessage += ' Möglicherweise ist nur eine Kamera verfügbar.';
      }
      console.error("Fehler beim Wechseln der Kamera:", error);
      this.speak(errorMessage);
    }
  }

  startLiveCameraAnalysis() {
    if (this.liveCameraInterval) {
      clearInterval(this.liveCameraInterval); // Clear any existing interval
    }    
 
    this.liveCameraInterval = setInterval(async () => {
      // Live analysis only if camera is active AND user is asking about the camera
      if (this.cameraStream && this.lastSpokenText && 
          this.lastSpokenText.includes('kamera aktivieren')) {
        try {
          const videoTrack = this.cameraStream.getVideoTracks()[0];
          const imageCapture = new ImageCapture(videoTrack);
          const bitmap = await imageCapture.grabFrame();

          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
          const imageDataUrl = canvas.toDataURL('image/jpeg');

          const completion = await websim.chat.completions.create({
            messages: [
              {
                role: "system",
                content: `Du bist ein Assistent, der live auf das Kamerabild des Benutzers zugreift. Beantworte Fragen zum Kamerabild in Echtzeit. Beschreibe Änderungen im Bild, wenn sie auftreten.`,
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Beschreibe das aktuelle Kamerabild und alle Veränderungen seit der letzten Analyse.`,
                  },
                  {
                    type: "image_url",
                    image_url: { url: imageDataUrl },
                  },
                ],
              },
            ],
          });

          const response = completion.content;
          this.speak(response);

        } catch (error) {
          console.error("Fehler bei der Live-Kameraanalyse:", error);
          this.stopLiveCameraAnalysis();
        }
      }
    }, 3000);
  }

  stopLiveCameraAnalysis() {
    if (this.liveCameraInterval) {
      clearInterval(this.liveCameraInterval);
      this.liveCameraInterval = null;
    }
  }

  async handleMediaAnalysisRequest(speechText) {
    let sourceType = null;
    let facingMode = 'user'; // Default to user-facing camera

    if (speechText.includes('bildschirm')) {
        sourceType = 'screen';
    } else if (speechText.includes('kamera aktivieren')) { 
        sourceType = 'camera';
    }

    if (speechText.includes('wechseln')) {
        this.switchCamera();
        return;
    }

    if (!sourceType) {
        this.speak("Soll ich die Kamera oder den Bildschirm verwenden?");
        return;
    }

    this.speak(`Bitte warte, während ich auf die ${sourceType} zugreife.`);

    try {
        let stream;
        if (sourceType === 'camera') {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: facingMode },
            });
        } else {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        }

        const videoTrack = stream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(videoTrack);
        const bitmap = await imageCapture.grabFrame();

        videoTrack.stop();

        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
        const imageDataUrl = canvas.toDataURL('image/jpeg'); // Or any other format

        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Du bist ein Assistent, der den Bildschirm des Benutzers sieht. Antworte auf Fragen zum angezeigten Bildschirm.`,
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Bitte analysiere den Bildschirm und beantworte Fragen dazu.`,
                        },
                        {
                            type: "image_url",
                            image_url: { url: imageDataUrl },
                        },
                    ],
                },
            ],
        });

        const response = completion.content;
        this.conversationHistory.push(completion);
        this.speak(response);
    } catch (error) {
        let errorMessage = `Entschuldigung, es gab einen Fehler bei der Bildschirmfreigabe.`;
        if (error.message.includes('Permission denied')) {
            errorMessage += ' Bitte stelle sicher, dass die Berechtigungen erteilt wurden.';
        } else {
            errorMessage += ' Unbekannter Fehler: ' + error.message;
        }
        console.error("Fehler bei der Bildschirmfreigabe:", error);
        this.speak(errorMessage);
    }
  }

  requiresInternetAccess(text) {
    const keywords = ['wetter', 'nachrichten', 'aktuell', 'heute', 'kurs', 'börse'];
    return keywords.some(keyword => text.includes(keyword));
  }
  
  async handleInternetQuery(query) {
    const newMessage = {
      role: "user",
      content: query
    };
    this.conversationHistory.push(newMessage);
    this.conversationHistory = this.conversationHistory.slice(-10);

    try {
      const completion = await websim.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `Du bist ein hilfreicher Assistent, der Zugriff auf Echtzeitinformationen aus dem Internet hat. 
Der Benutzer hat folgende Informationen angegeben:
${this.settings.userName ? `Der Benutzer heißt ${this.settings.userName}.` : ''}
${this.settings.occupation ? `Beruf/Hobbys des Benutzers: ${this.settings.occupation}` : ''}
${this.settings.aiTraits ? `Deine Persönlichkeit ist: ${this.settings.aiTraits}` : ''}
${this.settings.additionalInfo ? `Zusätzliche Informationen: ${this.settings.additionalInfo}` : ''}

Beantworte die Anfrage präzise und auf Deutsch. Nutze das Werkzeug 'internetSuche', um relevante Informationen zu finden und lies das Ergebnis direkt vor.

Beispiel:
Benutzer: Wie ist das Wetter in Berlin?
Assistent: Das Wetter in Berlin ist aktuell 20 Grad Celsius und sonnig.
`
          },
          ...this.conversationHistory
        ]
      });

      const response = completion.content;
      this.conversationHistory.push(completion);
      
      this.expectingFollowUp = response.includes('[[FOLLOWUP]]');
      const cleanResponse = response.replace('[[FOLLOWUP]]', '').trim();
      
      this.speak(cleanResponse);
      
    } catch (error) {
      console.error('Fehler bei der AI-Antwort:', error);
      this.speak('Entschuldigung, es gab einen Fehler bei der Verarbeitung deiner Anfrage.');
    }
  }

  handleSpeechEnd() {
    // Make sure we reset isListening when speech recognition ends
    this.isListening = false;
    if (!this.synthesis.speaking) {
      this.stopListening();
    }
    // Save the last spoken text for later use
    if (this.recognition) {
      this.lastSpokenText = this.recognition.transcript;
    }
  }

  handleSpeechError(event) {
    console.error('Spracherkennungsfehler:', event.error);
    // Make sure we reset isListening on error
    this.isListening = false;
    this.stopListening();
    
    if (event.error !== 'not-allowed' && event.error !== 'audio-capture') {
      setTimeout(() => {
        this.startListening();
      }, 1000);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    const volumeIcon = document.querySelector('.fa-volume-up, .fa-volume-mute');
    
    if (this.isMuted) {
      volumeIcon.classList.replace('fa-volume-up', 'fa-volume-mute');
      this.synthesis.cancel(); // Stop any ongoing speech
    } else {
      volumeIcon.classList.replace('fa-volume-mute', 'fa-volume-up');
    }
    
    // Save mute state to localStorage
    localStorage.setItem('voiceAssistantMuted', JSON.stringify(this.isMuted));
  }

  updateInfoContent() {
    const aiSettings = document.getElementById('aiSettings');
    let content = '';
    
    if (this.settings.aiName || this.settings.userName || this.settings.occupation || 
        this.settings.aiTraits || this.settings.additionalInfo) {
      if (this.settings.aiName) {
        content += `<p><span class="setting-label">Name der KI:</span> ${this.settings.aiName}</p>`;
      }
      if (this.settings.userName) {
        content += `<p><span class="setting-label">Benutzername:</span> ${this.settings.userName}</p>`;
      }
      if (this.settings.occupation) {
        content += `<p><span class="setting-label">Beruf/Hobbys:</span> ${this.settings.occupation}</p>`;
      }
      if (this.settings.aiTraits) {
        content += `<p><span class="setting-label">KI Eigenschaften:</span> ${this.settings.aiTraits}</p>`;
      }
      if (this.settings.additionalInfo) {
        content += `<p><span class="setting-label">Zusätzliche Informationen:</span> ${this.settings.additionalInfo}</p>`;
      }
    } else {
      content = '<p class="no-settings">Keine Einstellungen konfiguriert</p>';
    }
    
    aiSettings.innerHTML = content;
  }

  setupFileHandling() {
    // Remove the old file button setup since we're using voice commands now
  }

  async handleFileCreation(fileType) {
    let prompt = '';
    switch(fileType) {
      case 'text':
        prompt = 'Gib mir bitte den Inhalt für die Textdatei.';
        break;
      case 'word':
        prompt = 'Beschreibe mir bitte den Inhalt für das Word-Dokument.';
        break;
      case 'excel':
        prompt = 'Nenne mir bitte die Daten für die Excel-Tabelle.';
        break;
      case 'powerpoint':
        prompt = 'Beschreibe mir bitte den Inhalt für die PowerPoint-Präsentation.';
        break;
    }

    this.speak(prompt);
    this.expectingFollowUp = true;
    this.fileCreationType = fileType;
  }

  async createFile(type, content) {
    try {
      const completion = await websim.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `Du bist ein Assistent für Dateierstellung. Erstelle eine ${type}-Datei basierend auf der Beschreibung.
Wähle das passende Format aus:
- text: text/plain (.txt)
- word: application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx)
- excel: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet (.xlsx)
- powerpoint: application/vnd.openxmlformats-officedocument.presentationml.presentation (.pptx)

Antworte im folgenden JSON-Format:
{
  "content": "Der formatierte Inhalt der Datei",
  "filename": "Vorgeschlagener Dateiname mit korrekter Dateiendung",
  "format": "Der korrekte MIME-Type basierend auf dem Dateityp"
}`
          },
          {
            role: "user",
            content: content
          }
        ],
        json: true
      });

      const result = JSON.parse(completion.content);
      
      // Ensure correct file extension based on type
      let filename = result.filename;
      if (!filename.toLowerCase().endsWith(`.${type === 'word' ? 'docx' : type === 'excel' ? 'xlsx' : type === 'powerpoint' ? 'pptx' : 'txt'}`)) {
        filename = result.filename.split('.').slice(0, -1).join('.') + `.${type === 'word' ? 'docx' : type === 'excel' ? 'xlsx' : type === 'powerpoint' ? 'pptx' : 'txt'}`;
      }
      
      // Ensure correct MIME type
      let mimeType = result.format;
      switch(type) {
        case 'text':
          mimeType = 'text/plain';
          break;
        case 'word':
          mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          break;
        case 'excel':
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          break;
        case 'powerpoint':
          mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
          break;
      }

      let fileContent;
      switch (type) {
        case 'text':
          fileContent = result.content;
          break;
        case 'word':
          // Create a minimal Word document XML structure
          fileContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${result.content}</w:t></w:r></w:p>
  </w:body>
</w:document>`;
          break;
        case 'excel':
          // Create a minimal Excel workbook XML structure
          fileContent = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetData>
        <row r="1">
            <c r="A1" t="inlineStr"><is><t>${result.content}</t></is></c>
        </row>
    </sheetData>
</worksheet>`;
          break;
        case 'powerpoint':
          // Return plain text since creating valid pptx with just javascript is not feasible
          fileContent = `Presentation content: ${result.content}`;
          break;
      }

      // Create and download the file
      const blob = new Blob([fileContent], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      this.speak(`Die ${type}-Datei wurde als ${filename} erstellt und der Download wurde gestartet.`);
    } catch (error) {
      console.error('Fehler bei der Dateierstellung:', error);
      this.speak('Entschuldigung, es gab einen Fehler bei der Dateierstellung.');
    }
  }

  saveChatHistory() {
    // Enhanced chat history formatting with proper timestamps
    const timestamp = new Date().toLocaleString('de-DE');
    let chatContent = '';
    
    chatContent += `Chat-Verlauf (${timestamp})\n\n`;

    this.conversationHistory.forEach(msg => {
      const role = msg.role === 'user' ? 'Benutzer' : 'KI';
      chatContent += `${role}:\n${msg.content}\n`;
    });

    chatContent += '\n---\n\n';

    // Create and trigger download
    const blob = new Blob([chatContent], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-verlauf-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    this.speak("Der Chat-Verlauf wurde als Textdatei gespeichert.");
  }

  openWebsite(websiteName) {
    const url = `https://${websiteName}.com`; 
    window.open(url, '_blank');
    this.speak(`Öffne ${websiteName}.`);
  }

  async startScreenShare() {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = stream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(videoTrack);
        const bitmap = await imageCapture.grabFrame();

        videoTrack.stop();

        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
        const imageDataUrl = canvas.toDataURL('image/jpeg'); // Or any other format

        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Du bist ein Assistent, der den Bildschirm des Benutzers sieht. Antworte auf Fragen zum angezeigten Bildschirm.`,
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Bitte analysiere den Bildschirm und beantworte Fragen dazu.`,
                        },
                        {
                            type: "image_url",
                            image_url: { url: imageDataUrl },
                        },
                    ],
                },
            ],
        });

        const response = completion.content;
        this.conversationHistory.push(completion);
        this.speak(response);
    } catch (error) {
        let errorMessage = `Entschuldigung, es gab einen Fehler bei der Bildschirmfreigabe.`;
        if (error.message.includes('Permission denied')) {
            errorMessage += ' Bitte stelle sicher, dass die Berechtigungen erteilt wurden.';
        } else {
            errorMessage += ' Unbekannter Fehler: ' + error.message;
        }
        console.error("Fehler bei der Bildschirmfreigabe:", error);
        this.speak(errorMessage);
    }
  }

  async accessCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
        });
        const videoTrack = stream.getVideoTracks()[0];
        const imageCapture = new ImageCapture(videoTrack);
        const bitmap = await imageCapture.grabFrame();

        videoTrack.stop();

        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
        const imageDataUrl = canvas.toDataURL('image/jpeg'); // Or any other format

        const completion = await websim.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Du bist ein Assistent, der Bilder analysieren kann. Der Benutzer hat dir ein Bild von der Kamera gesendet und erwartet Fragen dazu beantwortet zu bekommen.
Beantworte die Frage basierend auf dem Bild.`,
                },
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Bitte analysiere das Bild und beantworte die Frage des Benutzers.`,
                        },
                        {
                            type: "image_url",
                            image_url: { url: imageDataUrl },
                        },
                    ],
                },
            ],
        });

        const response = completion.content;
        this.conversationHistory.push(completion);
        this.speak(response);
    } catch (error) {
        let errorMessage = `Entschuldigung, es gab einen Fehler beim Zugriff auf die Kamera.`;
        if (error.message.includes('Permission denied')) {
            errorMessage += ' Bitte stelle sicher, dass die Berechtigungen erteilt wurden.';
        } else if (error.message.includes('Only one camera allowed.')) {
            errorMessage += ' Es ist nur eine Kamera gleichzeitig erlaubt.';
        } else if (error.message.includes('Could not start video source')) {
          errorMessage += ' Die Kamera konnte nicht gestartet werden. Stelle sicher, dass keine andere Anwendung die Kamera verwendet.';
        }
        else {
            errorMessage += ' Unbekannter Fehler: ' + error.message;
        }
        console.error("Fehler beim Zugriff auf die Kamera:", error);
        this.speak(errorMessage);
    }
  }

  setupStoreUI() {
    const storeOverlay = document.querySelector('.store-overlay');
    const closeStoreButton = document.querySelector('.close-store');
    const storeTabs = document.querySelectorAll('.store-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    const creditSlider = document.getElementById('creditSlider');
    const creditValue = document.getElementById('creditValue');
    const publishButton = document.getElementById('publishButton');
    const copyButton = document.getElementById('copyButton');
    const closeDetailButton = document.querySelector('.close-detail');
    const detailOverlay = document.querySelector('.detail-overlay');
    const useButton = document.getElementById('useButton');

    closeStoreButton.addEventListener('click', () => {
      storeOverlay.style.display = 'none';
    });
    
    storeTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // Remove active class from all tabs
        storeTabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        // Add active class to clicked tab
        tab.classList.add('active');
        
        // Show corresponding content
        const tabId = tab.getAttribute('data-tab');
        document.getElementById(`${tabId}-tab`).classList.add('active');
      });
    });
    
    creditSlider.addEventListener('input', () => {
      creditValue.textContent = creditSlider.value;
    });
    
    publishButton.addEventListener('click', () => {
      this.publishAssistant();
    });
    
    copyButton.addEventListener('click', () => {
      const urlField = document.getElementById('assistantUrl');
      navigator.clipboard.writeText(urlField.textContent)
        .then(() => {
          copyButton.textContent = 'Kopiert!';
          setTimeout(() => {
            copyButton.textContent = 'URL kopieren';
          }, 2000);
        });
    });
    
    closeDetailButton.addEventListener('click', () => {
      detailOverlay.style.display = 'none';
    });
    
    useButton.addEventListener('click', () => {
      const assistantId = useButton.getAttribute('data-id');
      this.useAssistant(assistantId);
    });
  }
  
  openStore() {
    document.querySelector('.store-overlay').style.display = 'flex';
    this.refreshAssistantsList();
  }
  
  async publishAssistant() {
    const name = document.getElementById('assistantName').value.trim();
    const traits = document.getElementById('assistantTraits').value.trim();
    const info = document.getElementById('assistantInfo').value.trim();
    const credits = document.getElementById('creditSlider').value;
    const internet = document.getElementById('internetToggle').checked;
    const file = document.getElementById('fileToggle').checked;
    const camera = document.getElementById('cameraToggle').checked;
    
    if (!name) {
      alert('Bitte gib einen Namen für den Assistenten ein!');
      return;
    }
    
    // Generate a unique ID with timestamp to ensure global uniqueness
    const id = 'assistant_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Get creator username from websim
    window.websim.getUser().then(user => {
        const username = user ? user.username : 'Anonymer Benutzer';
        
        const assistant = {
          id,
          name,
          traits,
          info,
          credits: parseInt(credits),
          features: {
            internet,
            file,
            camera
          },
          creator: username,
          createdAt: new Date().toISOString(),
          isPublic: true, // Always set to public
          status: 'Öffentlich' // Add status indicator
        };
        
        // Save to cloud
        this.saveAssistantToCloud(assistant);
        
        // Immediately show the URL
        const assistantUrl = this.generateAssistantURL(assistant.id);
        document.getElementById('assistantUrl').textContent = assistantUrl;
        document.getElementById('assistantUrl').style.display = 'block';
        document.getElementById('copyButton').style.display = 'block';
        
        // Show success message with public status
        const successMessage = document.getElementById('successMessage');
        successMessage.innerHTML = `
          <p>Dein Sprachassistent wurde erfolgreich veröffentlicht!</p>
          <p style="color: #4CAF50; margin-top: 5px;">Status: Öffentlich</p>
          <div class="assistant-url" id="assistantUrl">${assistantUrl}</div>
          <button class="copy-button" id="copyButton">URL kopieren</button>
        `;
        successMessage.style.display = 'block';
        
        // Scroll to see the success message
        successMessage.scrollIntoView({ behavior: 'smooth' });
        
        // Update the discover tab
        this.refreshAssistantsList();
    });
  }
  
  async saveAssistantToCloud(assistant) {
    try {
      // Use WebsimSocket records for persistent storage
      await this.room.collection('assistants').create(assistant);
      console.log("Assistant saved to cloud:", assistant);
      this.speak(`${assistant.name} wurde erfolgreich gespeichert und veröffentlicht.`);
      this.refreshAssistantsList(); // Refresh the list after saving

    } catch (error) {
      console.error("Failed to save assistant to cloud:", error);
      this.speak("Fehler beim Speichern des Assistenten.");
    }
  }
  
  loadAssistantsFromCloud() {
    // Remove all code regarding this function, and load assistants from the database.
    if (!this.room) return [];
    return this.room.collection('assistants').getList();
  }

  initWebsimSocket() {
    try {
      this.room = new WebsimSocket();
      
      // Load assistants from database
      this.refreshAssistantsList();

      // Set up collection subscription
      this.room.collection('assistants').subscribe((assistants) => {
        this.refreshAssistantsList(); // Update UI whenever the collection changes
      });

    } catch (error) {
      console.error("Failed to initialize WebsimSocket:", error);
    }
  }
  
  deleteAssistant(assistantId) {
    // Get existing assistants
    //let assistants = JSON.parse(localStorage.getItem('voiceAssistants') || '[]'); // Change local to records.
    
    // Remove the assistant
    //assistants = assistants.filter(a => a.id !== assistantId);
    
    // Save back to localStorage
    //localStorage.setItem('voiceAssistants', JSON.stringify(assistants));
    
    // Sync deletion to cloud
    //this.syncAssistantsToCloud(assistants);
      
    //Delete from database.
    this.room.collection('assistants').delete(assistantId);
    
    // Close the detail overlay
    document.querySelector('.detail-overlay').style.display = 'none';
    
    // Refresh the assistants list
    this.refreshAssistantsList();
    
    // If the deleted assistant was the current one, reset to standard
    const currentAssistantId = localStorage.getItem('lastUsedAssistantId');
    if (currentAssistantId === assistantId) {
        localStorage.removeItem('lastUsedAssistantId');
        this.useAssistant('standard');
    }
  }
  
  refreshAssistantsList() {
    // First try to get the latest assistants from cloud
    const assistants = this.loadAssistantsFromCloud();
    const container = document.getElementById('assistants-container');
    
    // Clear container
    container.innerHTML = '';
    
    const filteredAssistants = assistants.filter(assistant => assistant.id !== 'standard');

    if (!filteredAssistants || filteredAssistants.length === 0) { // Handle empty case properly
      container.innerHTML = '<p style="text-align:center;color:#aaa;padding:20px;">Keine Assistenten gefunden. Erstelle deinen eigenen!</p>';
      return;
    }
    
    // Sort by newest first
    filteredAssistants.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Create cards for each assistant
    filteredAssistants.forEach(assistant => {
      const card = document.createElement('div');
      card.className = 'assistant-card';
      card.dataset.id = assistant.id;
      
      card.innerHTML = `
        <div class="assistant-avatar">
          <i class="fas fa-robot"></i>
        </div>
        <div class="assistant-name">${assistant.name}</div>
        <div class="assistant-creator">von ${assistant.creator}</div>
        <div class="public-status">
          <i class="fas fa-globe"></i> Öffentlich
        </div>
        <div class="assistant-desc">
          ${assistant.traits || 'Keine Beschreibung'}
        </div>
      `;
      
      card.addEventListener('click', () => {
        this.showAssistantDetails(assistant);
      });
      
      container.appendChild(card);
    });
  }
  
  showAssistantDetails(assistant) {
    const detailOverlay = document.querySelector('.detail-overlay');
    const detailName = document.getElementById('detailName');
    const detailCreator = document.getElementById('detailCreator');
    const detailCredits = document.getElementById('detailCredits');
    const detailPersonality = document.getElementById('detailPersonality');
    const detailFunctions = document.getElementById('detailFunctions');
    const useButton = document.getElementById('useButton');
    
    detailName.textContent = assistant.name;
    detailCreator.textContent = `Erstellt von: ${assistant.creator}`;
    detailCredits.textContent = assistant.credits;
    detailPersonality.textContent = assistant.traits || 'Keine Persönlichkeit definiert';
    
    // Clear and set functions
    detailFunctions.innerHTML = '';
    if (assistant.features.internet) {
      const tag = document.createElement('div');
      tag.className = 'function-tag';
      tag.textContent = 'Internetsuche';
      detailFunctions.appendChild(tag);
    }
    
    if (assistant.features.file) {
      const tag = document.createElement('div');
      tag.className = 'function-tag';
      tag.textContent = 'Datei-Erstellung';
      detailFunctions.appendChild(tag);
    }
    
    if (assistant.features.camera) {
      const tag = document.createElement('div');
      tag.className = 'function-tag';
      tag.textContent = 'Kamera-Zugriff';
      detailFunctions.appendChild(tag);
    }
    
    // Set assistant ID to use button
    useButton.setAttribute('data-id', assistant.id);
    
    const shareButton = document.createElement('button');
    shareButton.textContent = 'Teilen';
    shareButton.className = 'share-button';
    shareButton.addEventListener('click', () => {
      const assistantFullUrl = this.generateAssistantURL(assistant.id);
      navigator.clipboard.writeText(assistantFullUrl)
        .then(() => {
          shareButton.textContent = 'Kopiert!';
          setTimeout(() => {
            shareButton.textContent = 'Teilen';
          }, 2000);
        });
    });
    
    // Add delete button for non-standard assistants
    if (assistant.id !== 'standard') {
      const deleteButton = document.createElement('button');
      deleteButton.textContent = 'Löschen';
      deleteButton.className = 'delete-button';
      deleteButton.addEventListener('click', () => {
        if (confirm('Möchtest du diesen Sprachassistenten wirklich löschen?')) {
          this.deleteAssistant(assistant.id);
        }
      });
      useButton.parentNode.appendChild(deleteButton);
    }

    useButton.parentNode.insertBefore(shareButton, useButton.nextSibling);

    // Show overlay
    detailOverlay.style.display = 'flex';
    // Remove the URL
    document.getElementById('assistantUrl').style.display = 'none';
  }

  useAssistant(assistantId) {
    // First, close the details overlay
    document.querySelector('.detail-overlay').style.display = 'none';
    document.querySelector('.store-overlay').style.display = 'none';
    
    // Find the assistant
    const assistants = this.loadAssistantsFromCloud();
    const assistant = assistants.find(a => a.id === assistantId);
    
    if (!assistant) {
      this.speak('Entschuldigung, dieser Assistent konnte nicht gefunden werden.');
      return;
    }
    
    // Update settings
    this.settings.aiName = assistant.name;
    this.settings.aiTraits = assistant.traits;
    this.settings.additionalInfo = assistant.info;
    
    // Update credits
    this.credits.maxAmount = assistant.credits;
    this.credits.amount = assistant.credits;
    
    // Save settings and last used assistant ID
    localStorage.setItem('voiceAssistantSettings', JSON.stringify(this.settings));
    localStorage.setItem('lastUsedAssistantId', assistantId);
    this.saveCredits();
    
    // Update UI
    this.updateCreditsDisplay();
    
    // Add to URL without reloading page
    const url = new URL(window.location);
    url.searchParams.set('assistant', assistantId);
    window.history.pushState({}, '', url);
    
    // Notify user
    this.speak(`Ich bin jetzt ${assistant.name}. Wie kann ich dir helfen?`);
  }
  
  checkForAssistantInURL() {
    const params = new URLSearchParams(window.location.search);
    const assistantId = params.get('assistant');
    
    if (assistantId === 'standard') {
        this.enableSettingsForm(document.querySelector('.settings-form')); // Re-enable settings
    }
    if (assistantId) {
      // Load the assistant
      const assistants = this.loadAssistantsFromCloud();
      const assistant = assistants.find(a => a.id === assistantId);
      
      if (assistant) {
        // Update settings
        this.settings.aiName = assistant.name;
        this.settings.aiTraits = assistant.traits;
        this.settings.additionalInfo = assistant.info;

        // Update credits
        this.credits.maxAmount = assistant.credits;
        this.credits.amount = assistant.credits;

        // Save settings
        localStorage.setItem('voiceAssistantSettings', JSON.stringify(this.settings));
        this.saveCredits();

        // Update UI
        this.updateCreditsDisplay();

        // Add to URL without reloading page
        const url = new URL(window.location);
        url.searchParams.set('assistant', assistantId);
        window.history.pushState({}, '', url);
      }
    }
  }

  // Helper function to generate the assistant URL
  generateAssistantURL(assistantId) {
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?assistant=${assistantId}`;
  }
  
  disableSettingsForm(form) {
    const elements = form.querySelectorAll('input, textarea, button');
    elements.forEach(element => {
      element.disabled = true;
    });

    // Add a visual cue
    form.style.opacity = 0.7;
  }

  enableSettingsForm(form) {
      form.querySelectorAll('input, textarea, button').forEach(el => el.disabled = false);
      form.style.opacity = 1;
  }
  
  // ... existing code ...
}

document.addEventListener('DOMContentLoaded', () => {
  new VoiceAssistant();
});