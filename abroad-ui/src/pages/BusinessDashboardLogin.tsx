import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "../components/card";
import { Input } from "../components/input";
import { Button } from "../components/button";

function AnimatedDestinations() {
  const texts = ["🇧🇷 Reales", "🇵🇪 Soles", "🇨🇴 Pesos"];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % texts.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={index}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.6 }}
        className="inline-block font-semibold ml-2"
      >
        {texts[index]}
      </motion.div>
    </AnimatePresence>
  );
}

export default function LoginPage() {
  const [language, setLanguage] = useState("en");
  const [email, setEmail] = useState("");
  const [showOTP, setShowOTP] = useState(false);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);

  const translations = {
    en: {
      otpTitle: "OTP Confirmation",
      otpDescription: "Paste the one time password code we sent to you by email.",
      sloganStart: "Stablecoins to",
      sloganEnd: "in seconds, no hours.",
      welcome: "Let's start",
      loginMessage: "Log in to your Abroad account",
      login: "Login",
      email: "Email",
      continue: "Continue",
      verify: "Verify",
      requestAgain: "Didn't receive code? Request again",
    },
    es: {
      otpTitle: "Confirmación OTP",
      otpDescription: "Pega el código de un solo uso que te enviamos por correo electrónico.",
      sloganStart: "Envía stablecoins a",
      sloganEnd: "en segundos, no horas.",
      welcome: "Comencemos!",
      loginMessage: "Inicia sesión en tu cuenta de Abroad",
      login: "Iniciar sesión",
      email: "Correo electrónico",
      continue: "Continuar",
      verify: "Verificar",
      requestAgain: "¿No recibiste el código? Solicítalo nuevamente",
    },
    pt: {
      otpTitle: "Confirmação OTP",
      otpDescription: "Cole o código de uso único que enviamos para o seu e-mail.",
      sloganStart: "De stablecoins para",
      sloganEnd: "em segundos, não horas.",
      welcome: "Vamos começar",
      loginMessage: "Faça login na sua conta Abroad",
      login: "Entrar",
      email: "Email",
      continue: "Continuar",
      verify: "Verificar",
      requestAgain: "Não recebeu o código? Solicite novamente",
    },
    zh: {
      otpTitle: "OTP 验证",
      otpDescription: "请输入我们发送到您邮箱的一次性验证码。",
      sloganStart: "从稳定币到",
      sloganEnd: "几秒到账，不再等待。",
      welcome: "让我们开始吧",
      loginMessage: "登录您的 Abroad 账户",
      login: "登录",
      email: "电子邮件",
      continue: "继续",
      verify: "验证",
      requestAgain: "未收到验证码？重新请求",
    },
  };

  const t = translations[language];

  return (
    <div className="min-h-screen relative grid grid-cols-1 md:grid-cols-2 bg-green-50">
      <div className="absolute top-4 right-4 z-50">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="rounded px-1 py-0.5 text-xs border border-gray-300"
        >
          <option value="en">EN</option>
          <option value="es">ES</option>
          <option value="pt">PT</option>
          <option value="zh">ZH</option>
        </select>
      </div>
      <div className="flex flex-col flex-1 items-start justify-center p-8">
        <div>
          <img
            src="https://cdn.prod.website-files.com/66d73974e0b6f2e9c06130a7/67bdb92323f0bb399db3754c_abroad-logo.svg"
            alt="Abroad Logo"
            className="h-12 mb-12 relative -top-[30px]"
          />
        </div>
        <div className="text-5xl font-bold text-left relative -top-[50px] leading-snug">
          {t.sloganStart} <AnimatedDestinations /> <br /> {t.sloganEnd}
        </div>
      </div>
      <div className="flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md"
        >
          {!showOTP ? (
            <Card className="rounded-2xl shadow-xl border-none">
              <CardContent className="p-6 min-h-[300px] flex flex-col justify-start">
                <h2 className="text-2xl font-bold text-center mb-1">{t.welcome}</h2>
                <p className="text-sm text-gray-500 text-center mb-6">{t.loginMessage}</p>
                <form className="flex flex-col space-y-4">
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t.email}
                    className="rounded-xl border-none focus:ring-2 focus:ring-green-600"
                    required
                  />
                  <Button
                    type="button"
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded"
                    onClick={() => setShowOTP(true)}
                  >
                    {t.continue}
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-2xl shadow-xl border-none">
              <CardContent className="p-6 min-h-[300px] flex flex-col justify-start relative">
                {/* Back Button */}
                <button
                  onClick={() => setShowOTP(false)}
                  className="absolute top-2 left-2 text-gray-500 hover:text-gray-700 focus:outline-none"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>

                {/* OTP Card Content */}
                <h3 className="text-lg font-semibold text-center">{t.otpTitle}</h3>
                <p className="text-sm text-gray-500 text-center mb-6">{t.otpDescription}</p>
                <div className="flex gap-2 justify-center mb-4">
                  {otp.map((digit, index) => (
                    <input
                      key={index}
                      type="text"
                      maxLength="1"
                      value={digit}
                      onChange={(e) => {
                        const newOtp = [...otp];
                        newOtp[index] = e.target.value;
                        setOtp(newOtp);
                      }}
                      className="w-10 h-12 text-center border rounded-lg text-xl focus:outline-none"
                    />
                  ))}
                </div>
                <Button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
                >
                  {t.verify}
                </Button>
                <p className="text-xs text-gray-500 text-center mt-4">
                  {t.requestAgain.split("Request again")[0]}
                  <span className="text-blue-600 cursor-pointer hover:underline">
                    Request again
                  </span>
                </p>
              </CardContent>
            </Card>
          )}
        </motion.div>
      </div>
    </div>
  );
}
