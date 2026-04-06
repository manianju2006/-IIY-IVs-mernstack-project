function adminLogin(){

let user = document.getElementById("adminuser").value.trim();
let pass = document.getElementById("adminpass").value.trim();

if(user === "admin" && pass === "1234")
{

localStorage.setItem("admin","true");   // this gives admin access

alert("Admin Login Successful");

window.location = "adminpanel.html";

}
else
{
alert("Wrong admin username or password");
}

}
