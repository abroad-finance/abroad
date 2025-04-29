import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "../components/card";
import { Input } from "../components/input";
import { Button } from "../components/button";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../services/firebase";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { createPartner } from "../api";

const countries = [
  { code: "AR", name: "Argentina", emoji: "🇦🇷" },
  { code: "BR", name: "Brazil", emoji: "🇧🇷" },
  { code: "CA", name: "Canada", emoji: "🇨🇦" },
  { code: "CL", name: "Chile", emoji: "🇨🇱" },
  { code: "CN", name: "China", emoji: "🇨🇳" },
  { code: "CO", name: "Colombia", emoji: "🇨🇴" },
  { code: "EC", name: "Ecuador", emoji: "🇪🇨" },
  { code: "EU", name: "European Union", emoji: "🇪🇺" },
  { code: "IN", name: "India", emoji: "🇮🇳" },
  { code: "MX", name: "Mexico", emoji: "🇲🇽" },
  { code: "PE", name: "Peru", emoji: "🇵🇪" },
  { code: "CH", name: "Switzerland", emoji: "🇨🇭" },
  { code: "GB", name: "United Kingdom", emoji: "🇬🇧" },
  { code: "US", name: "United States", emoji: "🇺🇸" },
  { code: "UY", name: "Uruguay", emoji: "🇺🇾" },
  { code: "OTHER", name: "Other Country/Region", emoji: "🌎" },
];

function AnimatedDestinations() {
  const texts = ["🇧🇷 Reales", "🇵🇪 Soles", "🇨🇴 Pesos"];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % texts.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [texts.length]);
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

type Language = "en" | "es" | "pt" | "zh";

export default function LoginPage() {
  const navigate = useNavigate();
  const [language, setLanguage] = useState<Language>("en");
  const { setUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showOTP, setShowOTP] = useState(false);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState<string>("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [country, setCountry] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");

  const handleLogin = () => {
    setError("");
    signInWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        setUser(userCredential.user);
        navigate("/dashboard");
      })
      .catch((err) => {
        setError(err.message);
      });
  };

  const handleRegister = useCallback(async () => {
    setError("");
    const response = await createPartner({company,country,phone,email,password,firstName,lastName})
    
    if (response.status === 201) {
      signInWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        setUser(userCredential.user);
        navigate("/dashboard");
      })
      .catch((err) => {
        setError(err.message);
      });
    }
    else {
      setError(response.statusText)
    }
  }, [company, country, phone, email, password, firstName, lastName, setUser, navigate]);

  const translations: Record<Language, {
    otpTitle: string;
    otpDescription: string;
    sloganStart: string;
    sloganEnd: string;
    welcome: string;
    loginMessage: string;
    login: string;
    email: string;
    pass_placeholder: string;
    continue: string;
    verify: string;
    requestAgain: string;
    register: string;
    noAccount: string;
    haveAccount: string;
    firstName: string;
    lastName: string;
    country: string;
    selectCountry: string;
    company: string;
    phone: string;
    registerTitle: string;
    registerSubtitle: string;
  }> = {
    en: {
      otpTitle: "OTP Confirmation",
      otpDescription: "Paste the one time password code we sent to you by email.",
      sloganStart: "Stablecoins to",
      sloganEnd: "in seconds, no hours.",
      welcome: "Let's start",
      loginMessage: "Log in to your Abroad account",
      login: "Login",
      email: "Email",
      pass_placeholder: "Type your password",
      continue: "Continue",
      verify: "Verify",
      requestAgain: "Didn't receive code? Request again",
      register: "Register",
      noAccount: "Don't have an account?",
      haveAccount: "Already have an account?",
      firstName: "First Name",
      lastName: "Last Name",
      country: "Country",
      selectCountry: "Select country or region",
      company: "Company Name",
      phone: "Phone Number",
      registerTitle: "Register a new account",
      registerSubtitle: "Create a new business account to make instant transfers.",
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
      pass_placeholder: "Digita tu contraseña",
      continue: "Continuar",
      verify: "Verificar",
      requestAgain: "¿No recibiste el código? Solicítalo nuevamente",
      register: "Registrarse",
      noAccount: "¿No tienes una cuenta?",
      haveAccount: "¿Ya tienes una cuenta?",
      firstName: "Nombre",
      lastName: "Apellido",
      country: "País",
      selectCountry: "Selecciona país o región",
      company: "Nombre de la Empresa",
      phone: "Número de Teléfono",
      registerTitle: "Registrar una nueva cuenta",
      registerSubtitle: "Crea una cuenta de empresa para hacer transferencias instantáneas.",
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
      pass_placeholder: "Escreva sua senha",
      continue: "Continuar",
      verify: "Verificar",
      requestAgain: "Não recebeu o código? Solicite novamente",
      register: "Registrar",
      noAccount: "Não tem uma conta?",
      haveAccount: "Já tem uma conta?",
      firstName: "Nome",
      lastName: "Sobrenome",
      country: "País",
      selectCountry: "Selecione país ou região",
      company: "Nome da Empresa",
      phone: "Número de Telefone",
      registerTitle: "Registrar uma nova conta",
      registerSubtitle: "Crie uma conta empresarial para fazer transferências instantâneas.",
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
      pass_placeholder: "输入您的密码",
      continue: "继续",
      verify: "验证",
      requestAgain: "未收到验证码？重新请求",
      register: "注册",
      noAccount: "还没有账户？",
      haveAccount: "已有账户？",
      firstName: "名",
      lastName: "姓",
      country: "国家",
      selectCountry: "选择国家或地区",
      company: "公司名称",
      phone: "电话号码",
      registerTitle: "注册新账户",
      registerSubtitle: "创建商业账户并立即转账。",
    },
  };

  const t = translations[language];

  return (
    <div className="min-h-screen relative grid grid-cols-1 md:grid-cols-2 bg-green-50">
      <div className="absolute top-4 right-4 z-50">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          className="rounded px-1 py-0.5 text-xs border border-gray-300"
        >
          <option value="en">🇬🇧 EN</option>
          <option value="es">🇪🇸 ES</option>
          <option value="pt">🇧🇷 PT</option>
          <option value="zh">🇨🇳 ZH</option>
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
                <h2 className="text-2xl font-bold text-center mb-1">
                  {isRegistering ? t.registerTitle : t.welcome}
                </h2>
                <p className="text-sm text-gray-500 text-center mb-6">
                  {isRegistering ? t.registerSubtitle : t.loginMessage}
                </p>
                <form className="flex flex-col space-y-4">
                  {isRegistering && (
                    <>
                      <Input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder={t.firstName}
                        className="rounded-xl border-none focus:ring-2 focus:ring-green-600"
                        required
                      />
                      <Input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder={t.lastName}
                        className="rounded-xl border-none focus:ring-2 focus:ring-green-600"
                        required
                      />
                      <Input
                        type="text"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder={t.company}
                        className="rounded-xl border-none focus:ring-2 focus:ring-green-600"
                        required
                      />
                      <Input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder={t.phone}
                        className="rounded-xl border-none focus:ring-2 focus:ring-green-600"
                        required
                      />
                      <select
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className="rounded-xl border-none focus:ring-2 focus:ring-green-600 p-2"
                        required
                      >
                        <option value="">{t.selectCountry}</option>
                        {countries.map((country) => (
                          <option key={country.code} value={country.code}>
                            {country.emoji} {country.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t.email}
                    className="rounded-xl border-none focus:ring-2 focus:ring-green-600"
                    required
                  />
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t.pass_placeholder}
                      className="rounded-xl border-none focus:ring-2 focus:ring-green-600 pr-10"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    >
                      {showPassword ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                          className="w-5 h-5 text-gray-500"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                          />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                          className="w-5 h-5 text-gray-500"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                  {error && <p className="text-red-500 text-sm text-center">{error}</p>}
                  <Button
                    type="button"
                    className="bg-gradient-to-r from-[#356E6A] to-[#73B9A3] hover:from-[#2a5956] hover:to-[#5fa88d] text-white px-4 py-2 rounded"
                    onClick={isRegistering ? handleRegister : handleLogin}
                  >
                    {isRegistering ? t.register : t.continue}
                  </Button>
                  <p className="text-sm text-center text-gray-600">
                    {isRegistering ? t.haveAccount : t.noAccount}{" "}
                    <button
                      type="button"
                      onClick={() => setIsRegistering(!isRegistering)}
                      className="bg-gradient-to-r from-[#356E6A] to-[#73B9A3] bg-clip-text text-transparent font-medium hover:opacity-80"
                    >
                      {isRegistering ? t.login : t.register}
                    </button>
                  </p>
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
                      maxLength={1}
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
                  <span className="text-blue-600 cursor-pointer hover:underline">
                    {t.requestAgain}
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
