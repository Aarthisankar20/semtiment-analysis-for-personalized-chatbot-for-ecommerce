
import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut 
} from "firebase/auth";
import { auth } from './services/firebase';
import { dbService } from './services/dbService';
import { User, UserRole, Product, Review, Sentiment, Order } from './types';
import { CATEGORIES } from './constants';
import { Navbar } from './components/Navbar';
import { ProductCard } from './components/ProductCard';
import { Chatbot } from './components/Chatbot';
import { AdminDashboard } from './components/AdminDashboard';
import { geminiService } from './services/geminiService';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<{ productId: string; quantity: number }[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Current view management
  const [currentView, setCurrentView] = useState<'home' | 'admin' | 'cart' | 'orders'>('home');
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderFilter, setOrderFilter] = useState<'ALL' | 'COMPLETED' | 'PENDING'>('ALL');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  // Auth Inputs
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
   const [showPostReview, setShowPostReview] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'DEBIT'>('COD');
  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [reviewsState, setReviewsState] = useState<Record<string, { rating: number; comment: string }>>({});
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewProduct, setReviewProduct] = useState<Product | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [showRecommendModal, setShowRecommendModal] = useState(false);
  const [recommendedProducts, setRecommendedProducts] = useState<Product[]>([]);

  // Initialize Firebase Auth and Data Streams
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        let userData = await dbService.getUserData(fbUser.uid);
        if (!userData) {
          const role = fbUser.email?.toLowerCase().includes('admin') ? UserRole.ADMIN : UserRole.USER;
          const newUser: User = {
            id: fbUser.uid,
            email: fbUser.email || '',
            name: fbUser.displayName || (role === UserRole.ADMIN ? 'Admin' : 'Customer'),
            role
          };
          await dbService.saveUser(newUser);
          userData = newUser;
        }
        const userObj = userData as User;
        setCurrentUser(userObj);
        setCart((userData as any).cart || []);
        setCurrentView(userObj.role === UserRole.ADMIN ? 'admin' : 'home');
      } else {
        setCurrentUser(null);
        setCart([]);
      }
      setLoading(false);
    });

    const unsubscribeProducts = dbService.subscribeToProducts((fetchedProducts) => {
      setProducts(fetchedProducts);
    });

    return () => {
      unsubscribeAuth();
      unsubscribeProducts();
    };
  }, []);

  // Sync Cart to Firestore on change
  useEffect(() => {
    if (currentUser) {
      dbService.syncCart(currentUser.id, cart);
    }
  }, [cart, currentUser]);

  const loadOrders = async () => {
    if (!currentUser) return setOrders([]);
    setLoading(true);
    try {
      if (currentUser.role === UserRole.ADMIN) {
        const all = await dbService.getAllOrders();
        setOrders(all);
      } else {
        const my = await dbService.getOrdersForUser(currentUser.id);
        setOrders(my);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Load orders when view is orders or when user changes
  useEffect(() => {
    if (currentView === 'orders') {
      // default users to view completed orders
      if (currentUser?.role === UserRole.USER) setOrderFilter('COMPLETED');
      else setOrderFilter('ALL');
      loadOrders();
    }
  }, [currentView, currentUser]);

  const handleAuthAction = async () => {
    if (!emailInput || !passwordInput) {
      alert("Please fill in credentials");
      return;
    }
    setLoading(true);
    try {
      if (authMode === 'login') {
        await signInWithEmailAndPassword(auth, emailInput, passwordInput);
      } else {
        const res = await createUserWithEmailAndPassword(auth, emailInput, passwordInput);
        // Default Admin Logic: Check email for "admin" string
        const role = emailInput.toLowerCase().includes('admin') ? UserRole.ADMIN : UserRole.USER;
        const newUser: User = {
          id: res.user.uid,
          email: emailInput,
          name: nameInput || (role === UserRole.ADMIN ? 'Admin' : 'Customer'),
          role: role
        };
        await dbService.saveUser(newUser);
      }
      setEmailInput('');
      setPasswordInput('');
      setNameInput('');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    await signOut(auth);
    setCurrentUser(null);
    setLoading(false);
  };

  const addToCart = (productId: string) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === productId);
      if (existing) {
        return prev.map(item => item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { productId, quantity: 1 }];
    });
  };

  const openProductReview = (product: Product) => {
    setReviewProduct(product);
    setReviewRating(5);
    setReviewComment('');
    setShowReviewModal(true);
  };

  const openRecommendations = (product: Product) => {
    // Simple local recommendation: same category, exclude current, sort by rating
    const recs = products
      .filter(p => p.category === product.category && p.id !== product.id)
      .sort((a,b) => (b.rating || 0) - (a.rating || 0))
      .slice(0,6);
    setRecommendedProducts(recs);
    setShowRecommendModal(true);
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const openCheckout = () => {
    setPaymentMethod('COD'); // Initialize payment method
    setCardNumber(''); // Reset card number
    setCardName(''); // Reset card name
    setCardExpiry(''); // Reset card expiry
    setCardCvv(''); // Reset card CVV
    setShowCheckout(true); // Show checkout modal
  };

  const handleCompletePurchase = async () => {
    if (!currentUser) return;
    if (paymentMethod === 'DEBIT') {
      if (!cardNumber || !cardName || !cardExpiry || !cardCvv) {
        alert('Please fill in debit card details');
        return;
      }
    }
    setLoading(true);
    try {
      const order = {
        userId: currentUser.id,
        items: cart,
        total: cartTotal,
        payment: {
          method: paymentMethod,
          details: paymentMethod === 'DEBIT' ? { cardLast4: cardNumber.slice(-4), name: cardName } : { }
        },
        createdAt: new Date().toISOString()
      };
      await dbService.addOrder(order);

      // initialize reviews state for purchased items and show post-purchase review modal
      const initial: Record<string, { rating: number; comment: string }> = {};
      cart.forEach(item => {
        initial[item.productId] = { rating: 5, comment: '' };
      });
      setReviewsState(initial);

      setCart([]);
      setShowCheckout(false);
      setShowPostReview(true);
      alert('Order placed successfully! Please add reviews for your purchased items.');
    } catch (err: any) {
      alert(err.message || 'Error placing order');
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            p.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  const cartTotal = cart.reduce((acc, item) => {
    const product = products.find(p => p.id === item.productId);
    return acc + (product?.price || 0) * item.quantity;
  }, 0);

  // LOADING STATE
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Securely loading...</p>
        </div>
      </div>
    );
  }

  // AUTH GATE: If no user is logged in, show login/register only
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-[2.5rem] shadow-2xl p-10 border border-slate-100">
          <div className="text-center mb-10">
            <div className="w-16 h-16 bg-indigo-600 rounded-3xl flex items-center justify-center text-white shadow-xl shadow-indigo-200 mx-auto mb-6">
              <i className="fas fa-shopping-bag text-2xl"></i>
            </div>
            <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Senti<span className="text-indigo-600">cart</span></h2>
            <p className="text-slate-400 mt-3 font-medium">
              {authMode === 'login' ? 'Sign in to access your dashboard' : 'Create an account to start shopping'}
            </p>
          </div>
          <div className="space-y-6">
            {authMode === 'register' && <input className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400" placeholder="Full Name" value={nameInput} onChange={e => setNameInput(e.target.value)} />}
            <input className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400" placeholder="Email address" value={emailInput} onChange={e => setEmailInput(e.target.value)} />
            <input className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-400" type="password" placeholder="Password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} />
            <button onClick={handleAuthAction} className="w-full py-4 btn-primary text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-indigo-100 transition-all active:scale-95">{authMode === 'login' ? 'Sign In' : 'Register'}</button>
            <p className="text-center text-sm text-slate-400 font-medium">{authMode === 'login' ? "New here?" : "Already a member?"}<button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="ml-2 text-indigo-600 font-bold hover:underline">{authMode === 'login' ? 'Create Account' : 'Login'}</button></p>
          </div>
        </div>
      </div>
    );
  }

  // MAIN APP: Visible only after login
  return (
    <div className="min-h-screen bg-[#fcfdfe] flex flex-col">
      <Navbar 
        user={currentUser} 
        cartCount={cart.length} 
        onLogout={handleLogout} 
        onNavigate={(view) => { 
          if (view === 'admin' && currentUser.role !== UserRole.ADMIN) return;
          setCurrentView(view); 
        }} 
        onLoginClick={() => {}} // No-op as we are already logged in
      />

      <main className="flex-1 pb-10">
        {currentView === 'home' && currentUser.role === UserRole.USER && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 animate-in fade-in duration-700">
            {/* Store Header */}
            <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div>
                <h1 className="text-4xl font-black text-slate-900 tracking-tight">E-Commerce Store</h1>
                <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mt-2">Personalized Recommendations for you</p>
              </div>
              <div className="relative max-w-sm w-full">
                <input 
                  type="text" 
                  placeholder="Search products..." 
                  value={searchQuery} 
                  onChange={(e) => setSearchQuery(e.target.value)} 
                  className="w-full pl-6 pr-6 py-3.5 bg-white border border-slate-100 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-sm" 
                />
              </div>
            </div>

            {/* Categories */}
            <div className="flex items-center gap-2.5 overflow-x-auto pb-8 scroll-hide">
              {CATEGORIES.map(cat => (
                <button 
                  key={cat} 
                  onClick={() => setSelectedCategory(cat)} 
                  className={`px-5 py-2 rounded-xl whitespace-nowrap text-[10px] font-black uppercase tracking-widest transition-all border ${
                    selectedCategory === cat 
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-100' 
                      : 'bg-white text-slate-500 border-slate-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
              {filteredProducts.map(product => (
                <ProductCard key={product.id} product={product} onAddToCart={addToCart} onViewDetails={setSelectedProduct} onReview={openProductReview} onRecommend={openRecommendations} />
              ))}
            </div>
            
            {filteredProducts.length === 0 && (
              <div className="py-20 text-center text-slate-400">No products found matching your search.</div>
            )}
          </div>
        )}

        {currentView === 'admin' && currentUser.role === UserRole.ADMIN && (
          <AdminDashboard 
            products={products} 
            onAddProduct={(p) => dbService.addProduct({ ...p, reviews: [], rating: 5 })} 
            onDeleteProduct={(id) => dbService.deleteProduct(id)} 
            onUpdateProduct={(p) => dbService.updateProduct(p)} 
          />
        )}

        {currentView === 'cart' && (
          <div className="max-w-4xl mx-auto px-4 pt-12">
            <h2 className="text-3xl font-black mb-8">Checkout</h2>
            {cart.length === 0 ? (
              <div className="bg-white p-20 rounded-[3rem] text-center border border-slate-50">
                <p className="text-slate-400">Your bag is empty.</p>
                <button onClick={() => setCurrentView('home')} className="mt-6 btn-primary px-8 py-3 text-white rounded-xl font-bold text-xs uppercase tracking-widest">Back to Shop</button>
              </div>
            ) : (
              <div className="space-y-4">
                {cart.map(item => {
                  const product = products.find(p => p.id === item.productId);
                  if (!product) return null;
                  return (
                    <div key={item.productId} className="bg-white p-4 rounded-3xl border border-slate-50 flex items-center gap-6 shadow-sm">
                      <img src={product.image} className="w-16 h-20 rounded-xl object-cover" />
                      <div className="flex-1">
                        <h3 className="font-bold text-sm">{product.name}</h3>
                        <p className="font-black text-indigo-600">₹{product.price.toLocaleString('en-IN')}</p>
                      </div>
                      <button onClick={() => removeFromCart(item.productId)} className="text-red-500 p-2"><i className="fas fa-trash-alt"></i></button>
                    </div>
                  );
                })}
                <div className="mt-8 p-10 bg-white rounded-[2.5rem] shadow-xl flex flex-col md:flex-row justify-between items-center gap-6">
                  <div className="text-2xl font-black">Total: ₹{cartTotal.toLocaleString('en-IN')}</div>
                  <button onClick={openCheckout} className="btn-primary px-12 py-4 text-white rounded-2xl font-black text-xs uppercase tracking-widest">Complete Purchase</button>
                </div>
              </div>
            )}
          </div>
        )}
        {currentView === 'orders' && (
          <div className="max-w-4xl mx-auto px-4 pt-12">
            <h2 className="text-3xl font-black mb-8">Orders</h2>
            <div className="mb-6 flex items-center justify-between">
              <div className="text-sm text-slate-500">Showing: <span className="font-bold">{orderFilter === 'ALL' ? 'All' : orderFilter === 'COMPLETED' ? 'Completed' : 'Pending'}</span></div>
              <div className="flex items-center gap-2">
                <button onClick={() => setOrderFilter('ALL')} className={`px-3 py-1 rounded-lg ${orderFilter==='ALL'? 'bg-indigo-600 text-white':'bg-white text-slate-600 border'}`}>All</button>
                <button onClick={() => setOrderFilter('COMPLETED')} className={`px-3 py-1 rounded-lg ${orderFilter==='COMPLETED'? 'bg-indigo-600 text-white':'bg-white text-slate-600 border'}`}>Completed</button>
                <button onClick={() => setOrderFilter('PENDING')} className={`px-3 py-1 rounded-lg ${orderFilter==='PENDING'? 'bg-indigo-600 text-white':'bg-white text-slate-600 border'}`}>Pending</button>
              </div>
            </div>

            {orders.length === 0 ? (
              <div className="bg-white p-8 rounded-[2rem] text-center border border-slate-50">
                <p className="text-slate-400">No orders found.</p>
                <button onClick={() => setCurrentView('home')} className="mt-6 btn-primary px-8 py-3 text-white rounded-xl font-bold text-xs uppercase tracking-widest">Back to Shop</button>
              </div>
            ) : (
              <div className="space-y-4">
                {orders
                  .filter(o => {
                    const status = (o.status || 'PLACED');
                    if (orderFilter === 'ALL') return true;
                    if (orderFilter === 'COMPLETED') return status === 'COMPLETED';
                    return status !== 'COMPLETED';
                  })
                  .map(o => (
                  <div key={o.id} className="bg-white p-4 rounded-3xl border border-slate-50 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-bold">Order #{o.id}</div>
                        <div className="text-xs text-slate-400">Placed: {new Date(o.createdAt).toLocaleString()}</div>
                      </div>
                      <div className="text-indigo-600 font-black">₹{o.total.toLocaleString('en-IN')}</div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2">
                      {o.items.map(it => {
                        const prod = products.find(p => p.id === it.productId);
                        return (
                          <div key={it.productId} className="flex items-center gap-4">
                            <img src={prod?.image} className="w-12 h-14 object-cover rounded-md" />
                            <div className="flex-1">
                              <div className="font-bold text-sm">{prod?.name || it.productId}</div>
                              <div className="text-xs text-slate-400">Qty: {it.quantity}</div>
                            </div>
                            <div className="text-sm text-slate-600">₹{(prod?.price || 0).toLocaleString('en-IN')}</div>
                            {currentUser?.role === UserRole.USER && prod && (
                              <div className="ml-4">
                                <button onClick={() => openProductReview(prod)} className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold">Rate & Review</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 text-sm text-slate-500">Payment: {o.payment?.method || 'N/A'}</div>
                    <div className="mt-2 text-sm">
                      <span className="font-bold">Status:</span> <span className="uppercase text-xs font-black ml-2">{o.status || 'PLACED'}</span>
                    </div>
                    {currentUser?.role === UserRole.ADMIN && (o.status !== 'COMPLETED') && (
                      <div className="mt-3 flex justify-end">
                        <button onClick={async () => {
                          setLoading(true);
                          try {
                            await dbService.updateOrderStatus(o.id, 'COMPLETED');
                            await loadOrders();
                            alert('Order marked as completed');
                          } catch (err: any) {
                            alert(err?.message || 'Error updating order');
                          } finally {
                            setLoading(false);
                          }
                        }} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold">Mark Completed</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modals & Chatbot */}
      {selectedProduct && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
          <div className="bg-white rounded-[3rem] max-w-4xl w-full max-h-[90vh] overflow-y-auto flex flex-col md:flex-row relative">
            <button onClick={() => setSelectedProduct(null)} className="absolute top-6 right-6 z-10 w-10 h-10 bg-white/80 rounded-xl flex items-center justify-center text-slate-400 shadow-sm"><i className="fas fa-times"></i></button>
            <div className="w-full md:w-1/2 bg-slate-50 flex items-center justify-center p-8">
               <img src={selectedProduct.image} className="w-full max-w-xs aspect-[3/4] object-cover rounded-3xl shadow-xl" />
            </div>
            <div className="w-full md:w-1/2 p-10 md:p-14">
              <h2 className="text-2xl font-black text-slate-900 mb-2">{selectedProduct.name}</h2>
              <span className="text-2xl font-black text-indigo-600 block mb-6">₹{selectedProduct.price.toLocaleString('en-IN')}</span>
              <p className="text-slate-500 mb-10 text-sm leading-relaxed">{selectedProduct.description}</p>
              <button onClick={() => { addToCart(selectedProduct.id); setSelectedProduct(null); }} className="w-full py-4 btn-primary text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl">Add to Bag</button>
            </div>
          </div>
        </div>
      )}

      {showCheckout && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-black">Complete Purchase</h3>
              <button onClick={() => setShowCheckout(false)} className="text-slate-400"><i className="fas fa-times"></i></button>
            </div>

            <div className="mb-4">
              <div className="font-bold mb-2">Payment Method</div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2"><input type="radio" checked={paymentMethod === 'COD'} onChange={() => setPaymentMethod('COD')} /> COD</label>
                <label className="flex items-center gap-2"><input type="radio" checked={paymentMethod === 'DEBIT'} onChange={() => setPaymentMethod('DEBIT')} /> Debit Card</label>
              </div>
              {paymentMethod === 'DEBIT' && (
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <input placeholder="Card Number" value={cardNumber} onChange={e => setCardNumber(e.target.value)} className="w-full p-3 border rounded-xl" />
                  <input placeholder="Name on Card" value={cardName} onChange={e => setCardName(e.target.value)} className="w-full p-3 border rounded-xl" />
                  <div className="grid grid-cols-2 gap-3">
                    <input placeholder="MM/YY" value={cardExpiry} onChange={e => setCardExpiry(e.target.value)} className="p-3 border rounded-xl" />
                    <input placeholder="CVV" value={cardCvv} onChange={e => setCardCvv(e.target.value)} className="p-3 border rounded-xl" />
                  </div>
                </div>
              )}
            </div>

            {/* reviews moved to post-purchase modal */}

            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setShowCheckout(false)} className="px-4 py-2 rounded-xl border">Cancel</button>
              <button onClick={handleCompletePurchase} className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-bold">Place Order</button>
            </div>
          </div>
        </div>
      )}

      {showPostReview && (
        <div className="fixed inset-0 z-[115] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-black">Add Reviews for Purchased Items</h3>
              <button onClick={() => setShowPostReview(false)} className="text-slate-400"><i className="fas fa-times"></i></button>
            </div>

            <div className="space-y-3">
              {Object.keys(reviewsState).map(productId => {
                const prod = products.find(p => p.id === productId);
                if (!prod) return null;
                const rv = reviewsState[productId] || { rating: 5, comment: '' };
                return (
                  <div key={productId} className="p-3 border rounded-xl bg-slate-50">
                    <div className="flex items-center gap-3">
                      <img src={prod.image} className="w-12 h-14 object-cover rounded-md" />
                      <div className="flex-1">
                        <div className="font-bold text-sm">{prod.name}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2">
                      <label className="text-sm font-bold">Rating</label>
                      <select value={rv.rating} onChange={e => setReviewsState(s => ({ ...s, [productId]: { ...rv, rating: Number(e.target.value) } }))} className="p-2 border rounded-lg w-32">
                        <option value={5}>5</option>
                        <option value={4}>4</option>
                        <option value={3}>3</option>
                        <option value={2}>2</option>
                        <option value={1}>1</option>
                      </select>
                      <label className="text-sm font-bold">Comment</label>
                      <textarea value={rv.comment} onChange={e => setReviewsState(s => ({ ...s, [productId]: { ...rv, comment: e.target.value } }))} className="w-full p-3 border rounded-xl" rows={2} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-3 mt-4">
              <button onClick={() => setShowPostReview(false)} className="px-4 py-2 rounded-xl border">Skip</button>
              <button onClick={async () => {
                // submit reviews
                setLoading(true);
                try {
                  for (const productId of Object.keys(reviewsState)) {
                    const r = reviewsState[productId];
                    if (!r) continue;
                    if (r.comment.trim() === '' && !r.rating) continue;
                    const review: Review = {
                      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
                      userId: currentUser?.id || '',
                      userName: currentUser?.name || '',
                      rating: r.rating,
                      comment: r.comment,
                      sentiment: Sentiment.NEUTRAL,
                      date: new Date().toISOString()
                    };
                    await dbService.addReviewToProduct(productId, review);
                  }
                  setShowPostReview(false);
                  setCurrentView('home');
                  alert('Reviews submitted. Thank you!');
                } catch (err: any) {
                  alert(err?.message || 'Error submitting reviews');
                } finally {
                  setLoading(false);
                }
              }} className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-bold">Submit Reviews</button>
            </div>
          </div>
        </div>
      )}

      {showReviewModal && reviewProduct && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-black">Review: {reviewProduct.name}</h3>
              <button onClick={() => setShowReviewModal(false)} className="text-slate-400"><i className="fas fa-times"></i></button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="flex items-center gap-4">
                <img src={reviewProduct.image} className="w-20 h-24 object-cover rounded-md" />
                <div>
                  <div className="font-bold">{reviewProduct.name}</div>
                  <div className="text-sm text-slate-400">₹{reviewProduct.price.toLocaleString('en-IN')}</div>
                </div>
              </div>

              <label className="text-sm font-bold">Rating</label>
              <select value={reviewRating} onChange={e => setReviewRating(Number(e.target.value))} className="p-2 border rounded-lg w-32">
                <option value={5}>5</option>
                <option value={4}>4</option>
                <option value={3}>3</option>
                <option value={2}>2</option>
                <option value={1}>1</option>
              </select>

              <label className="text-sm font-bold">Comment</label>
              <textarea value={reviewComment} onChange={e => setReviewComment(e.target.value)} className="w-full p-3 border rounded-xl" rows={4} />

              <div className="flex items-center justify-end gap-3 mt-2">
                <button onClick={() => setShowReviewModal(false)} className="px-4 py-2 rounded-xl border">Cancel</button>
                <button onClick={async () => {
                  if (!currentUser || !reviewProduct) return;
                  setLoading(true);
                  try {
                    const review: Review = {
                      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
                      userId: currentUser.id,
                      userName: currentUser.name,
                      rating: reviewRating,
                      comment: reviewComment,
                      sentiment: Sentiment.NEUTRAL,
                      date: new Date().toISOString()
                    };
                    await dbService.addReviewToProduct(reviewProduct.id, review);
                    setShowReviewModal(false);
                    alert('Thank you for your review!');
                  } catch (err: any) {
                    alert(err?.message || 'Error saving review');
                  } finally {
                    setLoading(false);
                  }
                }} className="px-6 py-3 rounded-xl bg-indigo-600 text-white font-bold">Submit Review</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRecommendModal && (
        <div className="fixed inset-0 z-[125] flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-black">Recommended for you</h3>
              <button onClick={() => setShowRecommendModal(false)} className="text-slate-400"><i className="fas fa-times"></i></button>
            </div>

            {recommendedProducts.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No recommendations available.</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {recommendedProducts.map(p => (
                  <div key={p.id} className="bg-slate-50 p-4 rounded-2xl shadow-sm flex flex-col">
                    <img src={p.image} className="w-full h-36 object-cover rounded-md mb-3" />
                    <div className="flex-1">
                      <div className="font-bold text-sm">{p.name}</div>
                      <div className="text-xs text-slate-400">{p.category}</div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="font-black text-indigo-600">₹{p.price.toLocaleString('en-IN')}</div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { addToCart(p.id); setShowRecommendModal(false); }} className="px-3 py-2 bg-indigo-600 text-white rounded-lg">Add</button>
                        <button onClick={() => { setSelectedProduct(p); setShowRecommendModal(false); }} className="px-3 py-2 border rounded-lg">View</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {currentUser.role === UserRole.USER && (
        <Chatbot isOpen={isChatOpen} onClose={() => setIsChatOpen(!isChatOpen)} products={products} onAddToCart={addToCart} />
      )}
      
      <footer className="bg-slate-900 py-10 text-center"><span className="text-xl font-black text-white/20 tracking-widest uppercase">Senticart</span></footer>
    </div>
  );
};

export default App;
